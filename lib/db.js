'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  website TEXT,
  account_number TEXT,
  payment_terms TEXT,
  delivery_notes TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  material_type TEXT,
  sku TEXT,
  description TEXT,
  size TEXT,
  length REAL,
  width REAL,
  height REAL,
  thickness REAL,
  dim_unit TEXT DEFAULT 'in',
  color TEXT,
  grade TEXT,
  unit TEXT NOT NULL DEFAULT 'each',
  pack_size REAL NOT NULL DEFAULT 1,
  sell_price REAL,
  markup_pct REAL,
  waste_pct REAL NOT NULL DEFAULT 0,
  taxable INTEGER NOT NULL DEFAULT 1,
  stock_qty REAL,
  reorder_level REAL,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS material_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_sku TEXT,
  cost REAL NOT NULL DEFAULT 0,
  lead_time_days INTEGER,
  min_order_qty REAL,
  preferred INTEGER NOT NULL DEFAULT 0,
  price_date TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_prices_material ON material_prices(material_id);

CREATE TABLE IF NOT EXISTS fence_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  style TEXT,
  material_type TEXT,
  default_height REAL NOT NULL DEFAULT 6,
  post_spacing REAL NOT NULL DEFAULT 8,
  labor_price_per_ft REAL NOT NULL DEFAULT 0,
  labor_cost_per_ft REAL NOT NULL DEFAULT 0,
  labor_price_per_gate REAL NOT NULL DEFAULT 0,
  labor_cost_per_gate REAL NOT NULL DEFAULT 0,
  default_gate_material_id INTEGER REFERENCES materials(id) ON DELETE SET NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fence_type_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fence_type_id INTEGER NOT NULL REFERENCES fence_types(id) ON DELETE CASCADE,
  label TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  material_id INTEGER REFERENCES materials(id) ON DELETE SET NULL,
  rule TEXT NOT NULL DEFAULT 'per_ft',
  qty REAL NOT NULL DEFAULT 1,
  waste_pct REAL,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_components_type ON fence_type_components(fence_type_id);

CREATE TABLE IF NOT EXISTS estimates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  customer_name TEXT,
  customer_phone TEXT,
  customer_email TEXT,
  site_address TEXT,
  fence_type_id INTEGER REFERENCES fence_types(id) ON DELETE SET NULL,
  data TEXT NOT NULL DEFAULT '{}',
  total REAL NOT NULL DEFAULT 0,
  fence_length REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const DEFAULT_SETTINGS = {
  company_name: 'Coles Fencing',
  company_address: '',
  company_phone: '',
  company_email: '',
  currency_symbol: '$',
  length_unit: 'ft',
  tax_label: 'VAT',
  tax_rate: '17.5',
  default_markup_pct: '35',
  deposit_pct: '50',
  quote_valid_days: '30',
  estimate_prefix: 'Q-',
  next_estimate_number: '1001',
  quote_terms: 'Prices valid for 30 days. A deposit is required to schedule installation; the balance is due on completion. Customer is responsible for confirming property lines. Price excludes removal of rock or concrete below grade unless stated.',
};

function open(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'fence.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

  const seeded = db.prepare('SELECT COUNT(*) AS n FROM materials').get().n > 0
    || db.prepare("SELECT value FROM settings WHERE key = 'seeded'").get();
  if (!seeded && process.env.SKIP_SEED !== '1') {
    require('./seed').seed(db);
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('seeded', '1')").run();
  return db;
}

// Run several statements atomically.
function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { open, tx, DEFAULT_SETTINGS };
