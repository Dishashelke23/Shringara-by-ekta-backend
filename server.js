const express = require("express");
const mongoose = require("mongoose");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors({ origin: "https://www.theektaproject.org" }));

// ✅ Connect to MongoDB Atlas
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("MongoDB connected"))
.catch(err => console.error("MongoDB error:", err));

// ✅ Order Schema
const orderSchema = new mongoose.Schema({
  orderId: String,
  paymentId: String,
  amount: Number,
  currency: String,
  products: Array,
  customer: Object,
  status: { type: String, default: "Pending" },
  createdAt: { type: Date, default: Date.now }
});

const Order = mongoose.model("Order", orderSchema);

// ✅ Razorpay Instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ✅ Create Order Route
app.post("/create-order", async (req, res) => {
  try {
    const { amount, currency, products, customer } = req.body;

    const options = {
      amount: amount * 100, // convert to paise
      currency,
      receipt: "receipt_" + Date.now()
    };

    const order = await razorpay.orders.create(options);

    // Save to DB (status = pending initially)
    const newOrder = new Order({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      products,
      customer,
      status: "Created"
    });

    await newOrder.save();

    res.json(order);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error creating order");
  }
});

// ✅ Verify Payment Route
app.post("/verify-payment", async (req, res) => {
  try {
    const { orderId, paymentId, signature } = req.body;

    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(orderId + "|" + paymentId)
      .digest("hex");

    if (generatedSignature === signature) {
      // ✅ Update order in DB
      await Order.findOneAndUpdate(
        { orderId },
        { paymentId, status: "Paid" },
        { new: true }
      );

      res.json({ success: true, message: "Payment verified successfully" });
    } else {
      await Order.findOneAndUpdate(
        { orderId },
        { status: "Failed" },
        { new: true }
      );
      res.status(400).json({ success: false, message: "Invalid signature" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).send("Error verifying payment");
  }
});

// ✅ Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
