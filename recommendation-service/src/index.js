require('dotenv').config();

// src/index.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// Database Schemas
const userPreferenceSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    index: true
  },
  viewedProducts: [{
    productId: String,
    viewCount: Number,
    lastViewed: Date
  }],
  purchasedProducts: [{
    productId: String,
    purchaseDate: Date,
    category: String
  }],
  categoryPreferences: [{
    category: String,
    weight: Number
  }],
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

const productSimilaritySchema = new mongoose.Schema({
  productId: {
    type: String,
    required: true,
    index: true
  },
  similarProducts: [{
    productId: String,
    similarityScore: Number,
    commonPurchases: Number
  }],
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

const UserPreference = mongoose.model('UserPreference', userPreferenceSchema);
const ProductSimilarity = mongoose.model('ProductSimilarity', productSimilaritySchema);

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

// Utility Functions
async function updateUserPreferences(userId, productId, action) {
  let userPref = await UserPreference.findOne({ userId });
  
  if (!userPref) {
    userPref = new UserPreference({ userId, viewedProducts: [], purchasedProducts: [] });
  }

  if (action === 'view') {
    const viewedProduct = userPref.viewedProducts.find(p => p.productId === productId);
    if (viewedProduct) {
      viewedProduct.viewCount += 1;
      viewedProduct.lastViewed = new Date();
    } else {
      userPref.viewedProducts.push({
        productId,
        viewCount: 1,
        lastViewed: new Date()
      });
    }
  }

  userPref.lastUpdated = new Date();
  await userPref.save();
}

async function calculateProductSimilarity(productId) {
  const purchases = await UserPreference.find({
    'purchasedProducts.productId': productId
  });

  const coOccurrences = {};
  
  purchases.forEach(user => {
    user.purchasedProducts.forEach(purchase => {
      if (purchase.productId !== productId) {
        coOccurrences[purchase.productId] = (coOccurrences[purchase.productId] || 0) + 1;
      }
    });
  });

  const similarProducts = Object.entries(coOccurrences)
    .map(([similarProductId, count]) => ({
      productId: similarProductId,
      similarityScore: count / purchases.length,
      commonPurchases: count
    }))
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, 10);

  await ProductSimilarity.findOneAndUpdate(
    { productId },
    { 
      similarProducts,
      lastUpdated: new Date()
    },
    { upsert: true }
  );
}

// Routes

// POST /track-view - Track product view
app.post('/track-view', auth, async (req, res) => {
  try {
    const { productId } = req.body;
    await updateUserPreferences(req.user.id, productId, 'view');
    res.send({ message: 'View tracked successfully' });
  } catch (error) {
    res.status(500).send(error);
  }
});

// POST /track-purchase - Track product purchase
app.post('/track-purchase', auth, async (req, res) => {
  try {
    const { productId, category } = req.body;
    
    const userPref = await UserPreference.findOne({ userId: req.user.id });
    if (userPref) {
      userPref.purchasedProducts.push({
        productId,
        purchaseDate: new Date(),
        category
      });

      // Update category preferences
      const categoryPref = userPref.categoryPreferences.find(cp => cp.category === category);
      if (categoryPref) {
        categoryPref.weight += 1;
      } else {
        userPref.categoryPreferences.push({
          category,
          weight: 1
        });
      }

      await userPref.save();
    }

    // Trigger similarity recalculation
    await calculateProductSimilarity(productId);
    
    res.send({ message: 'Purchase tracked successfully' });
  } catch (error) {
    res.status(500).send(error);
  }
});

// GET /recommendations - Get personalized recommendations
app.get('/recommendations', auth, async (req, res) => {
  try {
    const userPref = await UserPreference.findOne({ userId: req.user.id });
    if (!userPref) {
      return res.send({ recommendations: [] });
    }

    // Get recently viewed products
    const recentlyViewed = userPref.viewedProducts
      .sort((a, b) => b.lastViewed - a.lastViewed)
      .slice(0, 5);

    // Get similar products for recently viewed items
    const similarProducts = await ProductSimilarity.find({
      productId: { $in: recentlyViewed.map(p => p.productId) }
    });

    // Get top categories
    const topCategories = userPref.categoryPreferences
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map(cp => cp.category);

    // Combine and deduplicate recommendations
    const recommendations = {
      similarToViewed: similarProducts.flatMap(ps => ps.similarProducts)
        .sort((a, b) => b.similarityScore - a.similarityScore)
        .slice(0, 10),
      topCategories
    };

    res.send(recommendations);
  } catch (error) {
    res.status(500).send(error);
  }
});

// GET /similar-products/:productId - Get similar products
app.get('/similar-products/:productId', async (req, res) => {
  try {
    const similarity = await ProductSimilarity.findOne({
      productId: req.params.productId
    });

    if (!similarity) {
      return res.send({ similarProducts: [] });
    }

    res.send({ similarProducts: similarity.similarProducts });
  } catch (error) {
    res.status(500).send(error);
  }
});

// Periodic jobs
async function updateSimilarities() {
  try {
    const products = await UserPreference.distinct('purchasedProducts.productId');
    for (const productId of products) {
      await calculateProductSimilarity(productId);
    }
    console.log('Similarity calculations updated');
  } catch (error) {
    console.error('Error updating similarities:', error);
  }
}

// Run similarity updates every 24 hours
setInterval(updateSimilarities, 24 * 60 * 60 * 1000);

// Server Configuration
const PORT = process.env.PORT || 3004;

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`Recommendation Service running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Error connecting to MongoDB:', error);
  });
