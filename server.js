// server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { MongoClient, ObjectId } = require('mongodb');

const app = express();

// ═════════════════════════════════════
// MIDDLEWARE
// ═════════════════════════════════════
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ═════════════════════════════════════
// IMPORT AUTH ROUTES
// ═════════════════════════════════════
const authRoutes = require('./auth');
app.use('/auth', authRoutes);

// ═════════════════════════════════════
// CLOUDINARY
// ═════════════════════════════════════
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ═════════════════════════════════════
// MONGODB
// ═════════════════════════════════════
let products_collection;

MongoClient.connect(process.env.MONGO_URI)
  .then(client => {
    const db = client.db('shivashakti_db');
    products_collection = db.collection('products');
    console.log('✅ Connected to MongoDB');
  })
  .catch(err => console.error('MongoDB error:', err));

// ═════════════════════════════════════
// MULTER
// ═════════════════════════════════════
const upload = multer({ storage: multer.memoryStorage() });

// ═════════════════════════════════════
// ROUTES
// ═════════════════════════════════════

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'shakti.html'));
});

// ✅ Upload Product WITH Category
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    const { name, price, category } = req.body;

    if (!category)
      return res.status(400).json({ error: "Category is required" });

    cloudinary.uploader.upload_stream(
      { resource_type: 'image' },
      async (error, result) => {
        if (error) return res.status(500).json({ error: error.message });

        const product = {
          name,
          price,
          category: category.trim().toLowerCase(),
          image_url: result.secure_url
        };

        const inserted = await products_collection.insertOne(product);
        product._id = inserted.insertedId.toString();

        res.status(201).json(product);
      }
    ).end(req.file.buffer);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Get Products (Filter by Category)
app.get('/api/products', async (req, res) => {
  try {
    const { category } = req.query;

    let query = {};
    if (category) {
      query = { category: category.trim().toLowerCase() };
    }

    const docs = await products_collection.find(query).toArray();
    docs.forEach(d => d._id = d._id.toString());

    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Get All Categories
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await products_collection.distinct('category');
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Product
app.delete('/api/products/:id', async (req, res) => {
  try {
    await products_collection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'Backend running' });
});

// ═════════════════════════════════════
// START SERVER (ONE PORT ONLY)
// ═════════════════════════════════════
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('====================================');
  console.log(`Server running on PORT ${PORT}`);
  console.log('====================================');
});
