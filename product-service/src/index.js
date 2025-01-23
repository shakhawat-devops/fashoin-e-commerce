require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// Database Schemas
const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  category: {
    type: String,
    required: true,
    enum: ['Clothing', 'Shoes', 'Accessories', 'Bags']
  },
  sizes: [{
    type: String,
    enum: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'ONE_SIZE', '30', '32', '34', '36', '38', '40', '41', '42', '43', '44']
  }],
  colors: [{
    name: String,
    hexCode: String
  }],
  stock: {
    type: Number,
    required: true,
    min: 0
  },
  images: [{
    url: String,
    isPrimary: Boolean
  }],
  sellerId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'out_of_stock'],
    default: 'active'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

const Product = mongoose.model('Product', productSchema);

// Authentication Middleware
const auth = async (req, res, next) => {
  try {
    console.log('Auth headers:', req.headers);
    const token = req.header('Authorization').replace('Bearer ', '');
    console.log('Token received:', token);
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Decoded token:', decoded);
    
    req.user = {
      _id: decoded._id,
      role: decoded.role
    };
    
    console.log('User object after auth:', req.user);
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).send({ error: 'Please authenticate.' });
  }
};

// Seller Authentication Middleware
const sellerAuth = async (req, res, next) => {
  console.log('SellerAuth - Current user:', req.user);
  console.log('SellerAuth - User role:', req.user?.role);

  if (req.user.role !== 'seller' && req.user.role !== 'admin') {
    console.log('Access denied - not a seller or admin');
    return res.status(403).send({ error: 'Access denied. Seller privileges required.' });
  }
  console.log('Seller authorization successful');
  next();
};

// Routes

// GET /products - Get all products
app.get('/products', async (req, res) => {
  try {
    const { category, minPrice, maxPrice, size, color, page = 1, limit = 10 } = req.query;
    
    const query = {};
    if (category) query.category = category;
    if (size) query.sizes = size;
    if (color) query['colors.name'] = color;
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }

    const products = await Product.find(query)
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .sort({ createdAt: -1 });

    const total = await Product.countDocuments(query);

    res.send({
      products,
      totalPages: Math.ceil(total / limit),
      currentPage: page
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).send(error);
  }
});

// POST /products - Create new product (sellers only)
app.post('/products', auth, sellerAuth, async (req, res) => {
  try {
    console.log('Create product request:', req.body);
    console.log('User creating product:', req.user);

    const product = new Product({
      ...req.body,
      sellerId: req.user._id
    });

    console.log('Product to be created:', product);

    await product.save();
    console.log('Product created successfully:', product._id);

    res.status(201).send(product);
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(400).send(error);
  }
});

// PUT /products/:id - Update product (sellers only)
app.put('/products/:id', auth, sellerAuth, async (req, res) => {
  const updates = Object.keys(req.body);
  const allowedUpdates = ['name', 'description', 'price', 'category', 'sizes', 'colors', 'stock', 'images', 'status'];
  const isValidOperation = updates.every(update => allowedUpdates.includes(update));

  if (!isValidOperation) {
    return res.status(400).send({ error: 'Invalid updates!' });
  }

  try {
    const product = await Product.findOne({
      _id: req.params.id,
      sellerId: req.user._id
    });

    if (!product) {
      return res.status(404).send();
    }

    updates.forEach(update => product[update] = req.body[update]);
    product.updatedAt = new Date();
    await product.save();
    res.send(product);
  } catch (error) {
    res.status(400).send(error);
  }
});

// DELETE /products/:id - Delete product (sellers only)
app.delete('/products/:id', auth, sellerAuth, async (req, res) => {
  try {
    const product = await Product.findOneAndDelete({
      _id: req.params.id,
      sellerId: req.user._id
    });

    if (!product) {
      return res.status(404).send();
    }

    res.send(product);
  } catch (error) {
    res.status(500).send(error);
  }
});

// Server Configuration
const PORT = process.env.PORT || 3002;

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB:', process.env.MONGODB_URI);
    app.listen(PORT, () => {
      console.log(`Product Management Service running on port ${PORT}`);
      console.log('JWT_SECRET is set:', !!process.env.JWT_SECRET);
    });
  })
  .catch((error) => {
    console.error('Error connecting to MongoDB:', error);
  });
