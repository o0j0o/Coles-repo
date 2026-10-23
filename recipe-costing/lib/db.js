'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  supplier TEXT,
  purchase_qty REAL NOT NULL DEFAULT 1,
  purchase_unit TEXT NOT NULL DEFAULT 'kg',
  purchase_price REAL NOT NULL DEFAULT 0,
  yield_pct REAL NOT NULL DEFAULT 100,
  density REAL,
  price_date TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS energy_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',
  unit TEXT NOT NULL DEFAULT 'kWh',
  pack_label TEXT,
  pack_size REAL NOT NULL DEFAULT 1,
  pack_price REAL NOT NULL DEFAULT 0,
  price_date TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',
  purchase_cost REAL NOT NULL DEFAULT 0,
  salvage_value REAL NOT NULL DEFAULT 0,
  life_years REAL NOT NULL DEFAULT 5,
  hours_per_year REAL NOT NULL DEFAULT 500,
  maintenance_per_year REAL NOT NULL DEFAULT 0,
  purchase_date TEXT,
  always_on INTEGER NOT NULL DEFAULT 0,
  capacity_qty REAL,
  capacity_unit TEXT,
  energy_use TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  product TEXT NOT NULL DEFAULT 'other',
  code TEXT,
  description TEXT,
  yield_qty REAL NOT NULL DEFAULT 1,
  yield_unit TEXT NOT NULL DEFAULT 'kg',
  density REAL,
  pack_name TEXT,
  pack_qty REAL,
  pack_unit TEXT,
  sell_price REAL,
  method TEXT,
  source_files TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipe_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id INTEGER REFERENCES ingredients(id),
  qty REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'g',
  basis TEXT NOT NULL DEFAULT 'batch',
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lines_recipe ON recipe_lines(recipe_id);

CREATE TABLE IF NOT EXISTS recipe_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  label TEXT,
  equipment_id INTEGER REFERENCES equipment(id),
  hours REAL NOT NULL DEFAULT 0,
  scaling TEXT NOT NULL DEFAULT 'fixed',
  load_capacity REAL,
  load_unit TEXT,
  days REAL,
  temp REAL,
  store_qty REAL,
  store_unit TEXT,
  energy TEXT NOT NULL DEFAULT '[]',
  labor_hours REAL NOT NULL DEFAULT 0,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_steps_recipe ON recipe_steps(recipe_id);
`;

// Columns added after the first release. CREATE TABLE IF NOT EXISTS won't add them to an existing database.
const ADDED_COLUMNS = {
  equipment: ['purchase_date TEXT', 'always_on INTEGER NOT NULL DEFAULT 0', 'capacity_qty REAL', 'capacity_unit TEXT'],
  recipe_steps: ['days REAL', 'store_qty REAL', 'store_unit TEXT', 'temp REAL'],
  recipes: ["source_files TEXT NOT NULL DEFAULT '[]'"],
};

function migrate(db) {
  Object.entries(ADDED_COLUMNS).forEach(([table, cols]) => {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
    cols.forEach(def => { if (!have.has(def.split(' ')[0])) db.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`); });
  });
}

const DEFAULT_SETTINGS = {
  company_name: 'Black Belly Smokers',
  currency_symbol: 'BBD$',
  labor_rate: '0',
  target_margin_pct: '50',
  unit_system: 'metric',
};

function open(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'recipes.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

  const seeded = db.prepare('SELECT COUNT(*) AS n FROM ingredients').get().n > 0
    || db.prepare("SELECT value FROM settings WHERE key = 'seeded'").get();
  if (!seeded && process.env.SKIP_SEED !== '1') {
    require('./seed').seed(db);
  }
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('seeded', '1')").run();
  require('./seed').upgradeSamples(db);
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
