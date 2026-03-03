require('dotenv').config(); // MUST be first

const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();

// ═════════════════════════════════════
// GLOBAL MIDDLEWARE
// ═════════════════════════════════════
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ═════════════════════════════════════
// CLOUDINARY CONFIG
// ═════════════════════════════════════
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ═════════════════════════════════════
// MONGODB
// ═════════════════════════════════════
const MONGO_URI = process.env.MONGO_URI;
let products_collection;

MongoClient.connect(MONGO_URI)
  .then(client => {
    const db = client.db('shivashakti_db');
    products_collection = db.collection('products');
    console.log('✅ Connected to MongoDB');
  })
  .catch(err => console.error('❌ MongoDB error:', err));

// ═════════════════════════════════════
// MULTER
// ═════════════════════════════════════
const storage = multer.memoryStorage();
const upload = multer({ storage });

// ═════════════════════════════════════
// WEBSITE ROUTES
// ═════════════════════════════════════
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'shakti.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ═════════════════════════════════════
// PRODUCT APIs
// ═════════════════════════════════════

// Upload product
app.post('/api/upload', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  const { name, price, category } = req.body;

  try {
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream((error, result) => {
          if (error) reject(error);
          else resolve(result);
        })
        .end(req.file.buffer);
    });

    const product_data = {
      name,
      price,
      image_url: result.secure_url,
      category
    };

    const inserted = await products_collection.insertOne(product_data);
    product_data._id = inserted.insertedId.toString();

    console.log(`[API] Product uploaded: "${name}" — category: "${category}"`);
    res.status(201).json({ message: 'Product uploaded successfully!', product: product_data });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get all products (with optional category filter)
app.get('/api/products', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const { category } = req.query;
    const query = category
      ? { category: { $regex: new RegExp('^' + category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } }
      : {};
    const docs = await products_collection.find(query).toArray();
    docs.forEach(d => d._id = d._id.toString());
    res.json(docs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete product
app.delete('/api/products/:id', async (req, res) => {
  try {
    await products_collection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ message: 'Product deleted successfully' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═════════════════════════════════════
// AUTH PROXY → forwards to auth.js on port 5001 internally
// ═════════════════════════════════════
const AUTH_SERVER = `http://localhost:${process.env.AUTH_PORT || 5001}`;

// ✅ FIXED: Build Google OAuth URL here and redirect to Google directly
// DO NOT redirect to localhost:5001 — browser can't reach that on Render
app.get('/auth/google', (req, res) => {
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'offline',
    prompt:        'consent'
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// ✅ Proxy: Google OAuth callback — handled internally, not redirected to browser
app.get('/auth/google/callback', async (req, res) => {
  try {
    const response = await axios.get(`${AUTH_SERVER}/auth/google/callback`, {
      params: req.query,
      // ✅ Don't follow redirects — get raw response
      maxRedirects: 0,
      validateStatus: status => status < 400
    });
    res.send(response.data);
  } catch (e) {
    res.status(500).send(`<script>window.opener && window.opener.postMessage({error:'${e.message}'},'*');window.close();</script>`);
  }
});

// Proxy: Send OTP
app.post('/auth/send-otp', async (req, res) => {
  try {
    const response = await axios.post(`${AUTH_SERVER}/auth/send-otp`, req.body);
    res.json(response.data);
  } catch (e) {
    const status = e.response?.status || 500;
    const error  = e.response?.data  || { error: e.message };
    res.status(status).json(error);
  }
});

// Proxy: Verify OTP
app.post('/auth/verify-otp', async (req, res) => {
  try {
    const response = await axios.post(`${AUTH_SERVER}/auth/verify-otp`, req.body);
    res.json(response.data);
  } catch (e) {
    const status = e.response?.status || 500;
    const error  = e.response?.data  || { error: e.message };
    res.status(status).json(error);
  }
});

// Proxy: Auth health check
app.get('/auth/health', async (req, res) => {
  try {
    const response = await axios.get(`${AUTH_SERVER}/auth/health`);
    res.json(response.data);
  } catch (e) {
    res.status(500).json({ error: 'Auth server unreachable' });
  }
});

// ═════════════════════════════════════
// HEALTH CHECK
// ═════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({ status: 'backend server running', port: process.env.PORT || 5000 });
});

// ═════════════════════════════════════
// START SERVER
// ═════════════════════════════════════
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('=============================================');
  console.log(`  Shivashakti Backend Server — PORT ${PORT}`);
  console.log('=============================================');
});
