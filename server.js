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

// ✅ Allow popup (Google OAuth) to communicate back via window.opener
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
  res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ═════════════════════════════════════
// ENV VARIABLES
// ═════════════════════════════════════
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI;
const RESEND_API_KEY       = process.env.RESEND_API_KEY;

const ALLOWED_EMAILS = [
  'shivashaktipattusarees@gmail.com',
  'second-admin@gmail.com'
];

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
// OTP SETTINGS
// ═════════════════════════════════════
const OTP_EXPIRY_SECONDS = 300;
const MAX_OTP_ATTEMPTS   = 5;
const otpStore = {};

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
    const product_data = { name, price, image_url: result.secure_url, category };
    const inserted = await products_collection.insertOne(product_data);
    product_data._id = inserted.insertedId.toString();
    console.log(`[API] Product uploaded: "${name}" — category: "${category}"`);
    res.status(201).json({ message: 'Product uploaded successfully!', product: product_data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

app.delete('/api/products/:id', async (req, res) => {
  try {
    await products_collection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ message: 'Product deleted successfully' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ✅ NEW: Update product (name, price, category, description, optional new image)
app.put('/api/products/:id', upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, price, category, description } = req.body;

    const updateData = { name, price, category, description };

    // If a new image was uploaded, push it to Cloudinary
    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload_stream((error, result) => {
            if (error) reject(error);
            else resolve(result);
          })
          .end(req.file.buffer);
      });
      updateData.image_url = result.secure_url;
    }

    const updated = await products_collection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (!updated) return res.status(404).json({ error: 'Product not found' });

    console.log(`[API] Product updated: "${name}" — id: ${id}`);
    res.json({ message: 'Product updated successfully!', product: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═════════════════════════════════════
// AUTH ROUTES — all in one server now
// ═════════════════════════════════════

app.get('/auth/google', (req, res) => {
  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'offline',
    prompt:        'consent'
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.send(popupHtml({ error: error || 'Login cancelled' }));
  try {
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri:  GOOGLE_REDIRECT_URI,
      grant_type:    'authorization_code'
    });
    const tokens = tokenRes.data;
    if (tokens.error) return res.send(popupHtml({ error: tokens.error_description || tokens.error }));
    const userRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const { email, name, picture } = userRes.data;
    res.send(popupHtml({ email, name, picture }));
  } catch (e) {
    res.send(popupHtml({ error: e.message }));
  }
});

app.post('/auth/send-otp', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  if (!ALLOWED_EMAILS.map(e => e.toLowerCase()).includes(email)) {
    return res.status(403).json({ error: 'Unauthorised email' });
  }
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  otpStore[email] = { otp, expiresAt: Date.now() + OTP_EXPIRY_SECONDS * 1000, attempts: 0 };
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Shivashakti Admin <onboarding@resend.dev>',
        to: email,
        subject: '🔐 Shivashakti Admin OTP',
        html: `
          <div style="font-family:Georgia,serif;max-width:480px;margin:auto;
                      background:#fdf6ec;border:1px solid #c9a84c;
                      border-radius:12px;padding:40px;text-align:center;">
            <h2 style="color:#8b0000;letter-spacing:2px;margin-bottom:4px;">Shivashakti Pattu Sarees</h2>
            <p style="color:#8b6040;font-size:0.85rem;margin-bottom:30px;">Admin Panel · One-Time Password</p>
            <p style="color:#3d1f00;font-size:1rem;margin-bottom:16px;">Your secure OTP is:</p>
            <div style="background:#8b0000;color:#e2c06a;font-size:2.8rem;font-weight:700;
                        letter-spacing:14px;padding:20px 30px;border-radius:10px;
                        display:inline-block;margin-bottom:24px;">${otp}</div>
            <p style="color:#8b6040;font-size:0.88rem;line-height:1.7;margin-bottom:10px;">
              Valid for <strong>5 minutes</strong> only.<br>Do not share this with anyone.
            </p>
            <p style="color:#c0392b;font-size:0.82rem;">If you did not request this, ignore this email.</p>
          </div>
        `
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Resend API error');
    console.log(`[AUTH] OTP sent to ${email}`);
    res.json({ message: 'OTP sent successfully' });
  } catch (e) {
    console.error('[AUTH ERROR]', e.message);
    res.status(500).json({ error: `Failed to send email: ${e.message}` });
  }
});

app.post('/auth/verify-otp', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const otp   = (req.body.otp   || '').trim();
  const record = otpStore[email];
  if (!record) return res.status(400).json({ error: 'No OTP found. Please request a new one.' });
  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    delete otpStore[email];
    return res.status(429).json({ error: 'Too many failed attempts. Please sign in again.' });
  }
  if (Date.now() > record.expiresAt) {
    delete otpStore[email];
    return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
  }
  if (otp !== record.otp) {
    otpStore[email].attempts += 1;
    const remaining = MAX_OTP_ATTEMPTS - otpStore[email].attempts;
    return res.status(400).json({ error: `Incorrect OTP. ${remaining} attempt(s) left.` });
  }
  delete otpStore[email];
  console.log(`[AUTH] OTP verified for ${email}`);
  res.json({ success: true });
});

app.get('/auth/health', (req, res) => {
  res.json({ status: 'server running', port: process.env.PORT || 5000 });
});

// ═════════════════════════════════════
// HELPER: Popup HTML
// ═════════════════════════════════════
function popupHtml({ email = '', name = '', picture = '', error = '' }) {
  const payload = JSON.stringify({ email, name, picture, error });
  return `<!DOCTYPE html>
<html>
<head><title>Authenticating...</title></head>
<body style="font-family:sans-serif;text-align:center;padding:60px;color:#555;background:#fdf6ec;">
  <p>${error ? 'Login failed: ' + error : 'Signed in! Closing window...'}</p>
  <script>
    try { window.opener && window.opener.postMessage(${payload}, '*'); } catch(e) {}
    setTimeout(() => window.close(), 800);
  <\/script>
</body>
</html>`;
}

// ═════════════════════════════════════
// HEALTH CHECK
// ═════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({ status: 'server running', port: process.env.PORT || 5000 });
});

// ✅ Safely expose Razorpay Key ID to frontend (Key ID is public-safe, never expose secret)
app.get('/api/razorpay-key', (req, res) => {
  res.json({ key: process.env.RAZORPAY_KEY_ID });
});

// ═════════════════════════════════════
// START SERVER — single port only
// ═════════════════════════════════════
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('=============================================');
  console.log(`  Shivashakti Server — PORT ${PORT}`);
  console.log('=============================================');
});
