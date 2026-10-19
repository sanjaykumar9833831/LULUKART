"use strict";
// Server-side catalog: the ONLY source of truth for prices.
let PRODUCTS = [
  { id: "LK-ELEC-01", name: "Wireless Bluetooth Headphones", category: "Electronics", price: 1499, mrp: 2999, emoji: "🎧", stock: 50 },
  { id: "LK-ELEC-02", name: "Fitness Smart Watch 1.83 inch", category: "Electronics", price: 2299, mrp: 4999, emoji: "⌚", stock: 35 },
  { id: "LK-ELEC-03", name: "Fast Charging Power Bank 20000mAh", category: "Electronics", price: 1199, mrp: 1799, emoji: "🔋", stock: 40 },
  { id: "LK-FASH-01", name: "Premium Cotton Printed T-Shirt", category: "Fashion", price: 399, mrp: 799, emoji: "👕", stock: 100 },
  { id: "LK-FASH-02", name: "Breathable Mesh Running Shoes", category: "Fashion", price: 1799, mrp: 3499, emoji: "👟", stock: 25 },
  { id: "LK-HOME-01", name: "Insulated Stainless Steel Water Bottle 1L", category: "Home", price: 349, mrp: 599, emoji: "🍶", stock: 80 },
  { id: "LK-GROC-01", name: "California Almonds Value Pack 500g", category: "Grocery", price: 449, mrp: 599, emoji: "🥜", stock: 60 },
  { id: "LK-GROC-02", name: "Royal Masala Chai Tea Leaves 250g", category: "Grocery", price: 199, mrp: 249, emoji: "🍵", stock: 90 }
];

let BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));
const COUPONS = { LULU10: 10 };
const FREE_SHIPPING_PAISE = 499 * 100;
const SHIPPING_PAISE = 49 * 100;

function syncMap() {
  BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));
}

function addProduct(item) {
  if (BY_ID.has(item.id)) {
    return { error: `SKU ID ${item.id} already exists in catalog. Use a unique SKU.` };
  }
  const prod = {
    id: String(item.id).trim(),
    name: String(item.name).trim(),
    category: String(item.category || "General").trim(),
    price: Math.round(Number(item.price)),
    mrp: Math.round(Number(item.mrp)),
    emoji: String(item.emoji || "🛍️").trim(),
    stock: Math.round(Number(item.stock || 50))
  };
  PRODUCTS.unshift(prod);
  syncMap();
  return { success: true, product: prod };
}

function deleteProduct(id) {
  if (!BY_ID.has(id)) {
    return { error: `Product ID ${id} not found.` };
  }
  PRODUCTS = PRODUCTS.filter(p => p.id !== id);
  syncMap();
  return { success: true };
}

function priceCart(items, couponCode) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 25) return { error: "Your cart is empty or invalid." };
  const seen = new Set();
  const lines = [];
  let subtotal = 0;
  for (const it of items) {
    const p = BY_ID.get(it && it.id);
    const qty = Number(it && it.qty);
    if (!p || seen.has(p.id) || !Number.isInteger(qty) || qty < 1 || qty > 10) return { error: "Invalid item in cart." };
    seen.add(p.id);
    subtotal += p.price * 100 * qty;
    lines.push({ id: p.id, name: p.name, qty, unit: p.price * 100 });
  }
  const code = String(couponCode || "").trim().toUpperCase();
  const pct = COUPONS[code] || 0;
  const discount = Math.round((subtotal * pct) / 100);
  const shipping = subtotal - discount >= FREE_SHIPPING_PAISE ? 0 : SHIPPING_PAISE;
  return { lines, subtotal, discount, shipping, total: subtotal - discount + shipping, coupon: pct ? code : "" };
}

module.exports = { PRODUCTS, priceCart, addProduct, deleteProduct };