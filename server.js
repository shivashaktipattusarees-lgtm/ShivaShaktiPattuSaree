require('dotenv').config(); // ✅ MUST be first

const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { MongoClient } = require('mongodb');
const path = require('path');

const app = express();

// ✅ Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Cloudinary Config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ✅ MongoDB Connection
const MONGO_URI = process.env.MONGO_URI;
let products_collection;

MongoClient.connect(MONGO_URI)
  .then(client => {
    const db = client.db('shivashakti_db');
    products_collection = db.collection('products');
    console.log('✅ Connected to MongoDB');
  })
  .catch(err => console.error('MongoDB error:', err));

// ✅ Multer
const storage = multer.memoryStorage();
const upload = multer({ storage });

// ✅ Default Route → Opens shakti.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'shakti.html'));
});

// ✅ Admin Page Route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ✅ Upload API
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

    res.status(201).json({
      message: 'Product uploaded successfully!',
      product: product_data
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ✅ Get Products API
app.get('/api/products', async (req, res) => {
  const { category } = req.query;

  try {
    const query = category
      ? { category: { $regex: new RegExp(`^${category.trim()}$`, 'i') } }
      : {};

    const docs = await products_collection.find(query).toArray();
    docs.forEach(d => d._id = d._id.toString());

    res.json(docs);

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ✅ Delete API
app.delete('/api/delete', async (req, res) => {
  const { name } = req.body;

  try {
    const result = await products_collection.deleteOne({ name });

    if (result.deletedCount)
      return res.json({ message: 'Deleted successfully' });

    res.status(404).json({ error: 'Product not found' });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ✅ IMPORTANT: Use Render Port
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});