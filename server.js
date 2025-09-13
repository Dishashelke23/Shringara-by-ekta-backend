const express = require("express");
const mongoose = require("mongoose");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
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

  if (req.method === "OPTIONS") return res.status(200).end();

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
// ✅ Order Schema
// --------------------
const orderSchema = new mongoose.Schema({
  orderId: String,
  paymentId: String,
  amount: Number,
  currency: String,
  products: Array,
  customer: Object,
  status: { type: String, default: "Pending" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date }
});

const Order = mongoose.model("Order", orderSchema);

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
app.post("/create-order", async (req, res) => {
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
    const ticket = await googleClient.verifyIdToken({ idToken: token, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();

    res.json({
      success: true,
      token: "google-token-" + Date.now(), // optional token for localStorage
      user: {
        id: payload.sub,
        name: payload.name,
        email: payload.email,
        picture: payload.picture
      }
    });
  } catch (err) {
    console.error("❌ Google Auth error:", err);
    res.status(401).json({ success: false, message: "Invalid token" });
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