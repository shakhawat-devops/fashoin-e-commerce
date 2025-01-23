require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// Database Schema
const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'seller'],
    default: 'user'
  },
  firstName: String,
  lastName: String,
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: Date,
  isActive: {
    type: Boolean,
    default: true
  }
});

// Password hashing middleware
userSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 8);
  }
  next();
});

const User = mongoose.model('User', userSchema);

// Authentication Middleware
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization').replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ _id: decoded._id, isActive: true });

    if (!user) {
      throw new Error();
    }

    req.token = token;
    req.user = user;
    next();
  } catch (error) {
    res.status(401).send({ error: 'Please authenticate.' });
  }
};

// Routes

// POST /register - User Registration
app.post('/register', async (req, res) => {
  try {
    console.log('Register request body:', req.body);
    const { email, password, firstName, lastName, role } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log('User already exists:', email);
      return res.status(400).send({ error: 'Email already registered' });
    }

    const user = new User({
      email,
      password,
      firstName,
      lastName,
      role: role || 'user'
    });

    await user.save();
    console.log('New user created:', {
      id: user._id,
      email: user.email,
      role: user.role
    });

    const tokenPayload = {
      _id: user._id.toString(),
      role: user.role
    };
    console.log('Registration token payload:', tokenPayload);

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET);
    console.log('Registration token generated:', token);
    
    res.status(201).send({ user, token });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(400).send(error);
  }
});

// POST /login - User Login
app.post('/login', async (req, res) => {
  try {
    console.log('Login request body:', req.body);
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    console.log('Login attempt for user:', email);
    console.log('Found user:', user);

    if (!user || !await bcrypt.compare(password, user.password)) {
      console.log('Invalid login attempt for:', email);
      return res.status(401).send({ error: 'Invalid login credentials' });
    }

    user.lastLogin = new Date();
    await user.save();

    const tokenPayload = {
      _id: user._id.toString(),
      role: user.role
    };
    console.log('Login token payload:', tokenPayload);

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET);
    console.log('Login token generated:', token);

    res.send({ user, token });
  } catch (error) {
    console.error('Login error:', error);
    res.status(400).send(error);
  }
});

// PUT /update-profile - Update User Profile
app.put('/update-profile', auth, async (req, res) => {
  const updates = Object.keys(req.body);
  const allowedUpdates = ['firstName', 'lastName', 'password', 'email'];
  const isValidOperation = updates.every(update => allowedUpdates.includes(update));

  if (!isValidOperation) {
    return res.status(400).send({ error: 'Invalid updates!' });
  }

  try {
    updates.forEach(update => req.user[update] = req.body[update]);
    await req.user.save();
    res.send(req.user);
  } catch (error) {
    res.status(400).send(error);
  }
});

// DELETE /delete-user - Delete User Account
app.delete('/delete-user', auth, async (req, res) => {
  try {
    req.user.isActive = false;
    await req.user.save();
    res.send({ message: 'User account deactivated successfully' });
  } catch (error) {
    res.status(500).send(error);
  }
});

// GET /users - Get all users (admin only)
app.get('/users', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).send({ error: 'Access denied' });
  }

  try {
    const users = await User.find({});
    res.send(users);
  } catch (error) {
    res.status(500).send(error);
  }
});

// Server Configuration
const PORT = process.env.PORT || 3001;

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB:', process.env.MONGODB_URI);
    app.listen(PORT, () => {
      console.log(`User Management Service running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Error connecting to MongoDB:', error);
  });
