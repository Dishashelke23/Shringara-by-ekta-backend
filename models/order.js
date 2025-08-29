const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
  razorpay_order_id: String,
  razorpay_payment_id: String,
  razorpay_signature: String,
  products: Array, // {name, size, qty, price}
  customer: Object, // {name, email, phone, address, city, state, pincode}
  amount: Number,
  status: { type: String, default: "Pending" },
}, { timestamps: true });

module.exports = mongoose.model("Order", orderSchema);
