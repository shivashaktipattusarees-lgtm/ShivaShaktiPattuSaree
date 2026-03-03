require("dotenv").config();

const express = require("express");
const path = require("path");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 5000;

// ================= MIDDLEWARE =================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// ================= AUTH ROUTES =================
const authRoutes = require("./auth");
app.use("/auth", authRoutes);

// ================= MONGODB =================
const client = new MongoClient(process.env.MONGO_URI);
let db;

async function connectDB() {
  await client.connect();
  db = client.db("ecommerce");
  console.log("MongoDB Connected");
}
connectDB();

// ================= ROUTES =================

// Home Page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "shakti.html"));
});

// Admin Page
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ================= CATEGORY + PRODUCT =================

// Add Product with Category
app.post("/add-product", async (req, res) => {
  try {
    const { name, price, category } = req.body;

    await db.collection("products").insertOne({
      name,
      price,
      category,
      createdAt: new Date()
    });

    res.json({ success: true, message: "Product Added" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get All Products
app.get("/products", async (req, res) => {
  const products = await db.collection("products").find().toArray();
  res.json(products);
});

// Get Products by Category
app.get("/products/:category", async (req, res) => {
  const category = req.params.category;

  const products = await db
    .collection("products")
    .find({ category })
    .toArray();

  res.json(products);
});

// ================= START SERVER =================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
