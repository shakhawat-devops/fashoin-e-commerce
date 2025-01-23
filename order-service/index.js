require('dotenv').config();

// src/index.js
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Database initialization
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS shopping_carts (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS cart_items (
        id SERIAL PRIMARY KEY,
        cart_id INTEGER REFERENCES shopping_carts(id),
        product_id VARCHAR(255) NOT NULL,
        quantity INTEGER NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL,
        total_amount DECIMAL(10,2) NOT NULL,
        shipping_address JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id),
        product_id VARCHAR(255) NOT NULL,
        quantity INTEGER NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id),
        amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(50) NOT NULL,
        payment_method VARCHAR(50) NOT NULL,
        transaction_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } finally {
    client.release();
  }
}

initializeDatabase().catch(console.error);

// Authentication Middleware
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization').replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: decoded._id };
    next();
  } catch (error) {
    res.status(401).send({ error: 'Please authenticate.' });
  }
};

// Shopping Cart Routes

// POST /cart/add - Add item to cart
app.post('/cart/add', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get or create shopping cart
    let cart = await client.query(
      'SELECT * FROM shopping_carts WHERE user_id = $1',
      [req.user.id]
    );

    if (cart.rows.length === 0) {
      cart = await client.query(
        'INSERT INTO shopping_carts (user_id) VALUES ($1) RETURNING *',
        [req.user.id]
      );
    }

    // Add item to cart
    const { product_id, quantity, price } = req.body;
    await client.query(
      'INSERT INTO cart_items (cart_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)',
      [cart.rows[0].id, product_id, quantity, price]
    );

    await client.query('COMMIT');
    res.status(201).send({ message: 'Item added to cart' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).send(error);
  } finally {
    client.release();
  }
});

// DELETE /cart/remove - Remove item from cart
app.delete('/cart/remove/:itemId', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query(
      'DELETE FROM cart_items WHERE id = $1 AND cart_id IN (SELECT id FROM shopping_carts WHERE user_id = $2)',
      [req.params.itemId, req.user.id]
    );
    res.send({ message: 'Item removed from cart' });
  } catch (error) {
    res.status(400).send(error);
  } finally {
    client.release();
  }
});

// GET /cart - Get cart contents
app.get('/cart', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const cart = await client.query(
      `SELECT ci.* FROM cart_items ci 
       JOIN shopping_carts sc ON ci.cart_id = sc.id 
       WHERE sc.user_id = $1`,
      [req.user.id]
    );
    res.send(cart.rows);
  } catch (error) {
    res.status(500).send(error);
  } finally {
    client.release();
  }
});

// Order Routes

// POST /order/place - Place new order
app.post('/order/place', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { shipping_address } = req.body;
    
    // Get cart items
    const cartItems = await client.query(
      `SELECT ci.* FROM cart_items ci 
       JOIN shopping_carts sc ON ci.cart_id = sc.id 
       WHERE sc.user_id = $1`,
      [req.user.id]
    );

    if (cartItems.rows.length === 0) {
      throw new Error('Cart is empty');
    }

    // Calculate total amount
    const totalAmount = cartItems.rows.reduce(
      (sum, item) => sum + item.price * item.quantity, 
      0
    );

    // Create order
    const order = await client.query(
      'INSERT INTO orders (user_id, status, total_amount, shipping_address) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, 'pending', totalAmount, shipping_address]
    );

    // Create order items
    for (const item of cartItems.rows) {
      await client.query(
        'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)',
        [order.rows[0].id, item.product_id, item.quantity, item.price]
      );
    }

    // Clear cart
    await client.query(
      'DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM shopping_carts WHERE user_id = $1)',
      [req.user.id]
    );

    await client.query('COMMIT');
    res.status(201).send(order.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(400).send(error);
  } finally {
    client.release();
  }
});

// POST /payment/process - Process payment
app.post('/payment/process', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { order_id, payment_method, token } = req.body;

    // Get order details
    const order = await client.query(
      'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
      [order_id, req.user.id]
    );

    if (order.rows.length === 0) {
      throw new Error('Order not found');
    }

    // Process payment with Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(order.rows[0].total_amount * 100), // Stripe expects amounts in cents
      currency: 'usd',
      payment_method: token,
      confirm: true
    });

    // Record payment
    await client.query(
      'INSERT INTO payments (order_id, amount, status, payment_method, transaction_id) VALUES ($1, $2, $3, $4, $5)',
      [order_id, order.rows[0].total_amount, 'completed', payment_method, paymentIntent.id]
    );

    // Update order status
    await client.query(
      'UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['paid', order_id]
    );

    res.send({ message: 'Payment processed successfully' });
  } catch (error) {
    res.status(400).send(error);
  } finally {
    client.release();
  }
});

// GET /orders - Get user's orders
app.get('/orders', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const orders = await client.query(
      `SELECT o.*, json_agg(oi.*) as items 
       FROM orders o 
       LEFT JOIN order_items oi ON o.id = oi.order_id 
       WHERE o.user_id = $1 
       GROUP BY o.id 
       ORDER BY o.created_at DESC`,
      [req.user.id]
    );
    res.send(orders.rows);
  } catch (error) {
    res.status(500).send(error);
  } finally {
    client.release();
  }
});

// Server Configuration
const PORT = process.env.PORT || 3003;

app.listen(PORT, () => {
  console.log(`Order and Payment Service running on port ${PORT}`);
});
