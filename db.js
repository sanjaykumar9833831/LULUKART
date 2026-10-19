"use strict";
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

function openDb(file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(`CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    razorpay_order_id TEXT UNIQUE NOT NULL,
    razorpay_payment_id TEXT,
    status TEXT NOT NULL DEFAULT 'CREATED',
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    items TEXT NOT NULL,
    customer TEXT NOT NULL,
    created_at TEXT NOT NULL,
    paid_at TEXT
  )`);
  return db;
}

module.exports = { openDb };