"use strict";
require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const Razorpay = require("razorpay");
const { openDb } = require("./db");
const { PRODUCTS, priceCart, addProduct, deleteProduct } = require("./products");

/* ---------- logging ---------- */
const log = (level, msg, meta = {}) =>
  (level === "error" ? console.error : console.log)(JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta }));

/* ---------- config ---------- */
const { RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET } = process.env;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "LULU2026";
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === "production";

if (!KEY_ID || !KEY_SECRET) {
  log("warn", "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not fully configured. Set them in .env before processing live payments.");
}

const rzp = new Razorpay({
  key_id: KEY_ID || "rzp_test_placeholder",
  key_secret: KEY_SECRET || "rzp_secret_placeholder",
});

const db = openDb(process.env.DB_PATH || "./data/lulukart.db");

const q = {
  insert: db.prepare(
    "INSERT INTO orders (id, razorpay_order_id, amount, currency, items, customer, created_at) VALUES (?, ?, ?, 'INR', ?, ?, ?)"
  ),
  byRzp: db.prepare("SELECT * FROM orders WHERE razorpay_order_id = ?"),
  allOrders: db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 50"),
  markPaid: db.prepare(
    "UPDATE orders SET status = 'PAID', razorpay_payment_id = ?, paid_at = ? WHERE razorpay_order_id = ? AND status != 'PAID'"
  ),
  markFailed: db.prepare("UPDATE orders SET status = 'PAYMENT_FAILED' WHERE razorpay_order_id = ? AND status = 'CREATED'"),
};

/* ---------- helpers ---------- */
const hmac = (secret, data) => crypto.createHmac("sha256", secret).update(data).digest("hex");
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
function settle(razorpayOrderId, paymentId) {
  const r = q.markPaid.run(paymentId, new Date().toISOString(), razorpayOrderId);
  if (r.changes) log("info", "order marked PAID", { razorpayOrderId, paymentId });
  return r.changes > 0;
}
function validateCustomer(c) {
  if (!c || typeof c !== "object") return { error: "Customer details are required." };
  const v = {
    name: String(c.name || "").trim(),
    email: String(c.email || "").trim(),
    contact: String(c.contact || "").trim(),
    address: String(c.address || "").trim(),
    pincode: String(c.pincode || "").trim(),
  };
  if (v.name.length < 2 || v.name.length > 80) return { error: "Enter your full name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) || v.email.length > 120) return { error: "Enter a valid email address." };
  if (!/^[6-9]\d{9}$/.test(v.contact)) return { error: "Enter a valid 10-digit mobile number." };
  if (v.address.length < 8 || v.address.length > 200) return { error: "Enter your full delivery address." };
  if (!/^\d{6}$/.test(v.pincode)) return { error: "Enter a valid 6-digit pincode." };
  return { value: v };
}

/* Protected Seller Panel Middleware */
function requireAdmin(req, res, next) {
  const auth = req.headers["x-admin-key"] || (req.body && req.body.adminKey) || req.query.key;
  if (!auth || !safeEqual(auth, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "Unauthorized! Sahi Admin Password chahiye." });
  }
  next();
}

/* ---------- app ---------- */
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://checkout.razorpay.com", "https://www.highrevenueformat.com", "https://*.highrevenueformat.com"],
        frameSrc: ["https://api.razorpay.com", "https://checkout.razorpay.com", "https://www.highrevenueformat.com", "https://*.highrevenueformat.com"],
        connectSrc: ["'self'", "https://api.razorpay.com", "https://lumberjack.razorpay.com", "https://*.highrevenueformat.com"],
        imgSrc: ["'self'", "data:", "https://*.razorpay.com", "https://*.highrevenueformat.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        formAction: ["'self'"],
        upgradeInsecureRequests: IS_PROD ? [] : null,
      },
    },
  })
);

/* Webhook */
app.post("/api/payment/webhook", express.raw({ type: "application/json", limit: "1mb" }), (req, res) => {
  if (!WEBHOOK_SECRET) return res.status(501).json({ error: "Webhook not configured" });
  const sig = req.get("x-razorpay-signature") || "";
  if (!Buffer.isBuffer(req.body) || !safeEqual(hmac(WEBHOOK_SECRET, req.body), sig)) {
    log("warn", "webhook rejected: bad signature");
    return res.status(400).json({ error: "Invalid signature" });
  }
  try {
    const event = JSON.parse(req.body.toString("utf8"));
    const pay = event.payload && event.payload.payment && event.payload.payment.entity;
    const order = pay && q.byRzp.get(pay.order_id);
    if (order) {
      if (event.event === "payment.captured" || event.event === "order.paid") {
        if (pay.amount === order.amount && pay.currency === order.currency) settle(pay.order_id, pay.id);
        else log("error", "webhook amount mismatch", { razorpayOrderId: pay.order_id });
      } else if (event.event === "payment.failed") {
        q.markFailed.run(pay.order_id);
      }
    }
    res.json({ ok: true });
  } catch (e) {
    log("error", "webhook handling failed", { err: e.message });
    res.status(500).json({ error: "Server error" });
  }
});

app.use(express.json({ limit: "50kb" }));
const apiLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });
const payLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
app.use("/api", apiLimiter);

/* Customer Catalog Endpoints */
app.get("/api/products", (_req, res) => res.json(PRODUCTS.map((p) => ({ ...p, price: p.price * 100, mrp: p.mrp * 100 }))));
app.post("/api/cart/quote", (req, res) => {
  const p = priceCart(req.body && req.body.items, req.body && req.body.coupon);
  if (p.error) return res.status(400).json({ error: p.error });
  res.json({ subtotal: p.subtotal, discount: p.discount, shipping: p.shipping, total: p.total, coupon: p.coupon });
});

/* ========================================================
   SELLER HUB ENDPOINTS (PASSWORD PROTECTED)
   ======================================================== */
app.post("/api/seller/verify-auth", (req, res) => {
  const { adminKey } = req.body || {};
  if (!adminKey || !safeEqual(adminKey, ADMIN_PASSWORD)) {
    return res.status(401).json({ success: false, error: "Galat Password! Kripya sahi admin password dalein." });
  }
  res.json({ success: true, message: "Authentication Successful" });
});

app.post("/api/seller/add-product", requireAdmin, (req, res) => {
  const { id, name, category, price, mrp, emoji, stock } = req.body || {};
  if (!id || !name || !price || !mrp) {
    return res.status(400).json({ error: "SKU, Product Name, Price, and MRP are required." });
  }
  const result = addProduct({ id, name, category, price: Number(price), mrp: Number(mrp), emoji, stock: Number(stock) || 50 });
  if (result.error) return res.status(400).json({ error: result.error });
  log("info", "new product added by verified admin", { id, name, price });
  res.json({ success: true, message: `Product ${id} listed successfully!`, product: result.product });
});

app.delete("/api/seller/delete-product/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const result = deleteProduct(id);
  if (result.error) return res.status(400).json({ error: result.error });
  log("info", "product removed by verified admin", { id });
  res.json({ success: true, message: "Product deleted from catalog." });
});

app.get("/api/seller/orders", requireAdmin, (_req, res) => {
  try {
    const orders = q.allOrders.all();
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch orders." });
  }
});

app.get("/seller", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "seller.html"));
});

/* Payment Endpoints */
app.post("/api/payment/create-order", payLimiter, async (req, res) => {
  try {
    const { items, coupon, customer } = req.body || {};
    const c = validateCustomer(customer);
    if (c.error) return res.status(400).json({ error: c.error });
    const priced = priceCart(items, coupon);
    if (priced.error) return res.status(400).json({ error: priced.error });

    const id = "LK" + crypto.randomBytes(5).toString("hex").toUpperCase();
    const order = await rzp.orders.create({ amount: priced.total, currency: "INR", receipt: id, notes: { orderId: id } });
    q.insert.run(id, order.id, priced.total, JSON.stringify(priced.lines), JSON.stringify(c.value), new Date().toISOString());
    log("info", "order created", { id, razorpayOrderId: order.id, amount: priced.total });
    res.json({ orderId: id, razorpayOrderId: order.id, amount: priced.total, currency: "INR", keyId: KEY_ID });
  } catch (e) {
    log("error", "create-order failed", { err: (e.error && e.error.description) || e.message });
    res.status(502).json({ error: "Could not start the payment. Please try again." });
  }
});

app.post("/api/payment/verify-payment", payLimiter, async (req, res) => {
  const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = req.body || {};
  if ([oid, pid, sig].some((v) => typeof v !== "string" || !v || v.length > 100))
    return res.status(400).json({ success: false, error: "Missing payment details." });
  try {
    const order = q.byRzp.get(oid);
    if (!order) return res.status(404).json({ success: false, error: "Order not found." });
    if (!safeEqual(hmac(KEY_SECRET, `${oid}|${pid}`), sig)) {
      log("warn", "signature mismatch", { razorpayOrderId: oid });
      return res.status(400).json({ success: false, error: "Payment verification failed." });
    }
    if (order.status === "PAID") return res.json({ success: true, orderId: order.id });

    let pay = await rzp.payments.fetch(pid);
    if (pay.order_id !== oid || pay.amount !== order.amount || pay.currency !== order.currency) {
      log("error", "payment details do not match order", { razorpayOrderId: oid, paymentId: pid });
      return res.status(400).json({ success: false, error: "Payment verification failed." });
    }
    if (pay.status === "authorized") pay = await rzp.payments.capture(pid, order.amount, "INR");
    if (pay.status !== "captured") return res.status(402).json({ success: false, error: "Payment is not completed yet." });

    settle(oid, pid);
    res.json({ success: true, orderId: order.id });
  } catch (e) {
    log("error", "verify-payment failed", { razorpayOrderId: oid, err: (e.error && e.error.description) || e.message });
    res.status(502).json({ success: false, error: "Could not confirm the payment. Do not pay again; contact support." });
  }
});

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: IS_PROD ? "1h" : 0 }));

app.use((err, _req, res, _next) => {
  log("error", "unhandled error", { err: err.message });
  res.status(err.status || 500).json({ error: err.status === 400 ? "Bad request." : "Server error." });
});

const server = app.listen(PORT, () => log("info", `LuluKart listening on port ${PORT}`));
const stop = (sig) => {
  log("info", `${sig} received, shutting down`);
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("unhandledRejection", (e) => log("error", "unhandledRejection", { err: String(e) }));