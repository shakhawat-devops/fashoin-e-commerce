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
const eventSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ['pageview', 'product_view', 'add_to_cart', 'purchase', 'search']
  },
  userId: String,
  sessionId: String,
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  data: {
    type: Map,
    of: mongoose.Schema.Types.Mixed
  }
});

const salesMetricSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
    index: true
  },
  totalSales: Number,
  totalOrders: Number,
  averageOrderValue: Number,
  productsSold: [{
    productId: String,
    quantity: Number,
    revenue: Number
  }],
  categoryBreakdown: [{
    category: String,
    sales: Number,
    orders: Number
  }]
});

const trafficMetricSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
    index: true
  },
  pageViews: Number,
  uniqueVisitors: Number,
  averageSessionDuration: Number,
  bounceRate: Number,
  topPages: [{
    path: String,
    views: Number,
    uniqueVisitors: Number
  }]
});

const Event = mongoose.model('Event', eventSchema);
const SalesMetric = mongoose.model('SalesMetric', salesMetricSchema);
const TrafficMetric = mongoose.model('TrafficMetric', trafficMetricSchema);

// Authentication Middleware
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization').replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: decoded._id, role: decoded.role };
    next();
  } catch (error) {
    res.status(401).send({ error: 'Please authenticate.' });
  }
};

// Admin Authentication Middleware
const adminAuth = async (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).send({ error: 'Access denied. Admin privileges required.' });
  }
  next();
};

// Routes

// POST /analytics/process - Process analytics event
app.post('/analytics/process', async (req, res) => {
  try {
    const { type, userId, sessionId, data } = req.body;
    
    const event = new Event({
      type,
      userId,
      sessionId,
      data
    });

    await event.save();
    res.status(201).send(event);
  } catch (error) {
    res.status(400).send(error);
  }
});

// GET /analytics/report/sales - Get sales analytics
app.get('/analytics/report/sales', auth, adminAuth, async (req, res) => {
  try {
    const { startDate, endDate, groupBy = 'day' } = req.query;
    
    const dateRange = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };

    const salesMetrics = await SalesMetric.aggregate([
      {
        $match: { date: dateRange }
      },
      {
        $group: {
          _id: groupBy === 'month' 
            ? { $dateToString: { format: '%Y-%m', date: '$date' } }
            : { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          totalSales: { $sum: '$totalSales' },
          totalOrders: { $sum: '$totalOrders' },
          averageOrderValue: { $avg: '$averageOrderValue' },
          productsSold: { $push: '$productsSold' },
          categoryBreakdown: { $push: '$categoryBreakdown' }
        }
      },
      {
        $sort: { '_id': 1 }
      }
    ]);

    res.send(salesMetrics);
  } catch (error) {
    res.status(500).send(error);
  }
});

// GET /analytics/report/traffic - Get traffic analytics
app.get('/analytics/report/traffic', auth, adminAuth, async (req, res) => {
  try {
    const { startDate, endDate, groupBy = 'day' } = req.query;

    const dateRange = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };

    const trafficMetrics = await TrafficMetric.aggregate([
      {
        $match: { date: dateRange }
      },
      {
        $group: {
          _id: groupBy === 'month'
            ? { $dateToString: { format: '%Y-%m', date: '$date' } }
            : { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          pageViews: { $sum: '$pageViews' },
          uniqueVisitors: { $sum: '$uniqueVisitors' },
          averageSessionDuration: { $avg: '$averageSessionDuration' },
          bounceRate: { $avg: '$bounceRate' },
          topPages: { $push: '$topPages' }
        }
      },
      {
        $sort: { '_id': 1 }
      }
    ]);

    res.send(trafficMetrics);
  } catch (error) {
    res.status(500).send(error);
  }
});

// GET /analytics/report/products - Get product performance analytics
app.get('/analytics/report/products', auth, adminAuth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const productMetrics = await Event.aggregate([
      {
        $match: {
          type: 'product_view',
          timestamp: {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
          }
        }
      },
      {
        $group: {
          _id: '$data.productId',
          views: { $sum: 1 },
          uniqueVisitors: { $addToSet: '$userId' }
        }
      },
      {
        $project: {
          productId: '$_id',
          views: 1,
          uniqueVisitors: { $size: '$uniqueVisitors' }
        }
      },
      {
        $sort: { views: -1 }
      }
    ]);

    res.send(productMetrics);
  } catch (error) {
    res.status(500).send(error);
  }
});

// Utility Functions
async function aggregateDailyMetrics() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    // Aggregate sales metrics
    const salesEvents = await Event.find({
      type: 'purchase',
      timestamp: {
        $gte: yesterday,
        $lt: today
      }
    });

    const salesMetric = new SalesMetric({
      date: yesterday,
      totalSales: salesEvents.reduce((sum, event) => sum + event.data.get('amount'), 0),
      totalOrders: salesEvents.length,
      averageOrderValue: salesEvents.length > 0 
        ? salesEvents.reduce((sum, event) => sum + event.data.get('amount'), 0) / salesEvents.length 
        : 0
    });

    // Aggregate traffic metrics
    const pageViews = await Event.countDocuments({
      type: 'pageview',
      timestamp: {
        $gte: yesterday,
        $lt: today
      }
    });

    const uniqueVisitors = await Event.distinct('userId', {
      type: 'pageview',
      timestamp: {
        $gte: yesterday,
        $lt: today
      }
    }).length;

    const trafficMetric = new TrafficMetric({
      date: yesterday,
      pageViews,
      uniqueVisitors
    });

    await Promise.all([
      salesMetric.save(),
      trafficMetric.save()
    ]);

    console.log('Daily metrics aggregated successfully');
  } catch (error) {
    console.error('Error aggregating daily metrics:', error);
  }
}

// Run daily aggregation at midnight
setInterval(aggregateDailyMetrics, 24 * 60 * 60 * 1000);

// Server Configuration
const PORT = process.env.PORT || 3005;

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    app.listen(PORT, () => {
      console.log(`Analytics Service running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Error connecting to MongoDB:', error);
  });
