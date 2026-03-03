require('dotenv').config(); // MUST be first

const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { MongoClient } = require('mongodb');
const cors = require('cors');
const axios = require('axios');
const nodemailer = require('nodemailer');
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
  api_key: process.env.CLOUDINARY_API_KEY,
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
  .catch(err => console.error('MongoDB error:', err));

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

    res.status(201).json({ message: 'Product uploaded successfully!', product: product_data });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    const docs = await products_collection.find({}).toArray();
    docs.forEach(d => d._id = d._id.toString());
    res.json(docs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═════════════════════════════════════
// AUTH SECTION
// ═════════════════════════════════════
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI;
const SENDER_EMAIL         = process.env.SENDER_EMAIL;
const SENDER_APP_PASSWORD  = process.env.SENDER_APP_PASSWORD;

const ALLOWED_EMAILS = [
  'shivashaktipattusarees@gmail.com',
  'second-admin@gmail.com'
];

const OTP_EXPIRY_SECONDS = 300;
const MAX_OTP_ATTEMPTS   = 5;
const otpStore = {};

// ── Google OAuth Redirect ──
app.get('/auth/google', (req, res) => {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile'
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// ── Send OTP ──
app.post('/auth/send-otp', async (req, res) => {
  const email = (req.body.email || '').toLowerCase();

  if (!ALLOWED_EMAILS.includes(email))
    return res.status(403).json({ error: 'Unauthorised email' });

  const otp = String(Math.floor(100000 + Math.random() * 900000));

  otpStore[email] = {
    otp,
    expiresAt: Date.now() + OTP_EXPIRY_SECONDS * 1000,
    attempts: 0
  };

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: SENDER_EMAIL, pass: SENDER_APP_PASSWORD }
    });

    await transporter.sendMail({
      from: SENDER_EMAIL,
      to: email,
      subject: 'Shivashakti Admin OTP',
      text: `Your OTP is ${otp}. Valid for 5 minutes.`
    });

    res.json({ message: 'OTP sent successfully' });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Verify OTP ──
app.post('/auth/verify-otp', (req, res) => {
  const email = (req.body.email || '').toLowerCase();
  const otp = req.body.otp;

  const record = otpStore[email];
  if (!record) return res.status(400).json({ error: 'No OTP found' });

  if (Date.now() > record.expiresAt)
    return res.status(400).json({ error: 'OTP expired' });

  if (otp !== record.otp)
    return res.status(400).json({ error: 'Incorrect OTP' });

  delete otpStore[email];
  res.json({ success: true });
});

// ═════════════════════════════════════
// SINGLE PORT (RENDER SAFE)
// ═════════════════════════════════════
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});