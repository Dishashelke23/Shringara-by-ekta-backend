const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const Razorpay = require("razorpay");
const crypto = require("crypto");

const Order = require("./models/order"); // your Order model

dotenv.config();

const app = express();
app.use(express.json());

// CORS
const allowedOrigins = [
  process.env.FRONTEND_ORIGIN
];

app.use(cors({
  origin: function(origin, callback){
    if(!origin || allowedOrigins.includes(origin)){
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));

// MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("MongoDB error:", err.message));

// Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Health check
app.get("/api/health", (req, res) => res.json({ ok: true }));

// CREATE ORDER
app.post("/api/orders/create", async (req, res) => {
  try {
    const { cart, summary, customer } = req.body;
    if(!Array.isArray(cart) || !summary || !customer) return res.status(400).json({error:"Invalid payload"});

    const amountInPaise = Math.round(Number(summary.grand) * 100);

    const receipt = "ekta_" + Date.now();
    const rpOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt
    });

    const orderDoc = await Order.create({
      razorpay_order_id: rpOrder.id,
      receipt,
      status: "Created",
      currency: "INR",
      subtotal: Number(summary.subtotal),
      shipping: Number(summary.shipping),
      grandTotal: Number(summary.grand),
      customer,
      items: cart.map(i => ({
        productId: i.productId || "",
        name: i.name,
        size: i.size || "",
        qty: Number(i.qty || 1),
        price: Number(i.price),
        image: i.image || ""
      }))
    });

    res.json({
      key: process.env.RAZORPAY_KEY_ID,
      orderId: rpOrder.id,
      amount: Number(summary.grand),
      currency: "INR",
      dbId: orderDoc._id
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Unable to create order" });
  }
});

// VERIFY PAYMENT
app.post("/api/orders/verify", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const sign = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
                       .update(razorpay_order_id + "|" + razorpay_payment_id)
                       .digest("hex");

    if(sign !== razorpay_signature) return res.json({ success:false, message:"Signature mismatch" });

    await Order.findOneAndUpdate(
      { razorpay_order_id },
      { razorpay_payment_id, razorpay_signature, status:"Paid", paidAt: new Date() }
    );

    res.json({ success:true });
  } catch(err) {
    console.error(err);
    res.status(500).json({ success:false, message:"Server error" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));

app.get("/", (req, res) => res.send("Backend is live!"));
