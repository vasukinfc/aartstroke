-- AART STROKE: safe, idempotent Cloudflare D1 initialization.
-- This does NOT delete or overwrite existing customer orders.
-- Always confirm the correct Cloudflare account/database and back up records first.
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  data_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_recent ON orders(saved_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS orders_trash (
  id TEXT PRIMARY KEY,
  order_no TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  data_json TEXT NOT NULL,
  deleted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders_history (
  order_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  order_no TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  data_json TEXT NOT NULL,
  PRIMARY KEY (order_id, revision)
);
CREATE TABLE IF NOT EXISTS order_counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS order_approvals (
  token_hash TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewer TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  responded_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approvals_for_order ON order_approvals(order_id, created_at);
