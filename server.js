const express = require("express");
const mongoose = require("mongoose");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();

// --------------------
// ✅ CORS Middleware
// --------------------
app.use((req, res, next) => {
  const allowedOrigins = [
    "https://www.theektaproject.org",
    "http://localhost:8000",
    "http://127.0.0.1:5500",
    "http://127.0.0.1:3001",
    "http://localhost:3001"
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  next();
});

app.use(express.json());

// --------------------
// ✅ MongoDB Connection
// --------------------
mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB connected successfully"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// --------------------
// ✅ User Schema
// --------------------
const userSchema = new mongoose.Schema({
  googleId: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  name: String,
  picture: String,
  createdAt: { type: Date, default: Date.now },
  lastLogin: Date
});

const User = mongoose.model("User", userSchema);

// --------------------
// ✅ Order Schema
// --------------------
const orderSchema = new mongoose.Schema({
  orderId: String,
  paymentId: String,
  amount: Number,
  currency: String,
  products: Array,
  customer: Object,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  status: { type: String, default: "Pending" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date }
});

const Order = mongoose.model("Order", orderSchema);

// --------------------
// ✅ JWT Setup - FIXED: Consistent secret usage
// --------------------
const JWT_SECRET = process.env.JWT_SECRET || "your-jwt-secret-key";

const generateToken = (user) => {
  return jwt.sign(
    { userId: user._id, email: user.email },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
};

// --------------------
// ✅ Middleware to verify JWT - FIXED: Consistent secret usage
// --------------------
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ success: false, message: "Access token required" });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: "Invalid or expired token" });
    }
    req.user = user;
    next();
  });
};

// --------------------
// ✅ Razorpay Instance
// --------------------
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Test Razorpay connection
razorpay.orders.all({ count: 1 }, (err) => {
  if (err) console.error("❌ Razorpay connection error:", err);
  else console.log("✅ Razorpay connected successfully");
});

// --------------------
// 🔹 Create Order
// --------------------
app.post("/create-order", authenticateToken, async (req, res) => {
  try {
    const { amount, currency, products, customer } = req.body;
    if (!amount || !products || !customer) return res.status(400).json({ error: "Missing required fields" });

    const options = {
      amount: Math.round(amount * 100),
      currency: currency || "INR",
      receipt: "receipt_" + Date.now()
    };

    const order = await razorpay.orders.create(options);
    const newOrder = new Order({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      products,
      customer,
      userId: req.user.userId,
      status: "Created"
    });
    await newOrder.save();

    console.log("✅ Order created:", order.id);

    res.json({ id: order.id, amount: order.amount, currency: order.currency, key: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    console.error("❌ Error creating order:", err);
    res.status(500).json({ error: "Error creating order", message: err.error ? err.error.description : err.message });
  }
});

// --------------------
// 🔹 Verify Payment
// --------------------
app.post("/verify-payment", async (req, res) => {
  try {
    const { orderId, paymentId, signature } = req.body;
    if (!orderId || !paymentId || !signature) return res.status(400).json({ success: false, message: "Missing payment verification fields" });

    const generatedSignature = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(orderId + "|" + paymentId)
      .digest("hex");

    if (generatedSignature === signature) {
      await Order.findOneAndUpdate({ orderId }, { paymentId, status: "Paid", updatedAt: new Date() }, { new: true });
      console.log("✅ Payment verified:", orderId);
      res.json({ success: true, message: "Payment verified successfully" });
    } else {
      await Order.findOneAndUpdate({ orderId }, { status: "Failed", updatedAt: new Date() }, { new: true });
      console.error("❌ Invalid signature for order:", orderId);
      res.status(400).json({ success: false, message: "Invalid signature" });
    }
  } catch (err) {
    console.error("❌ Error verifying payment:", err);
    res.status(500).json({ success: false, error: "Error verifying payment", message: err.message });
  }
});

// --------------------
// 🔹 Google OAuth
// --------------------
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Send client ID to frontend
app.get("/config/google", (req, res) => {
  res.json({ clientId: process.env.GOOGLE_CLIENT_ID });
});

// Verify Google login
app.post("/auth/google", async (req, res) => {
  try {
    const { token } = req.body;
    const ticket = await googleClient.verifyIdToken({ 
      idToken: token, 
      audience: process.env.GOOGLE_CLIENT_ID 
    });
    const payload = ticket.getPayload();

    // Find or create user
    let user = await User.findOne({ googleId: payload.sub });
    
    if (!user) {
      user = new User({
        googleId: payload.sub,
        email: payload.email,
        name: payload.name,
        picture: payload.picture,
        lastLogin: new Date()
      });
    } else {
      user.lastLogin = new Date();
    }
    
    await user.save();

    // Generate JWT token
    const jwtToken = generateToken(user);

    res.json({
      success: true,
      token: jwtToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        picture: user.picture
      }
    });
  } catch (err) {
    console.error("❌ Google Auth error:", err);
    res.status(401).json({ success: false, message: "Invalid token" });
  }
});

// --------------------
// 🔹 Protected Route - User Orders
// --------------------
app.get("/api/user/orders", authenticateToken, async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.user.userId }).sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (err) {
    console.error("❌ Error fetching orders:", err);
    res.status(500).json({ success: false, message: "Error fetching orders" });
  }
});

// --------------------
// 🔹 Check Authentication Status
// --------------------
app.get("/api/auth/check", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    
    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        picture: user.picture
      }
    });
  } catch (err) {
    console.error("❌ Auth check error:", err);
    res.status(500).json({ success: false, message: "Error checking authentication" });
  }
});

// --------------------
// 🔹 Health & Test Routes
// --------------------
app.get("/test", (req, res) => res.send("Server is working!"));
app.get("/health", (req, res) => res.json({ status: "OK", timestamp: new Date().toISOString(), razorpay: razorpay.key_id ? "Connected" : "Not connected" }));

// --------------------
// ✅ Start Server
// --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

process.on("uncaughtException", err => console.error("❌ Uncaught Exception:", err));
process.on("unhandledRejection", err => console.error("❌ Unhandled Rejection:", err));