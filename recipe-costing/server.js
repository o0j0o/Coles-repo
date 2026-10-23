'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { open, tx } = require('./lib/db');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('recipes:' + APP_PASSWORD).digest('hex');
const SESSION_DAYS = 30;
const MAX_BODY = 10 * 1024 * 1024;

const db = open(DATA_DIR);

// ---------- helpers ----------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, body, headers) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  const data = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, Object.assign({
    'Content-Type': isJson ? 'application/json' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  }, headers));
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}

function makeToken() {
  const exp = String(Date.now() + SESSION_DAYS * 86400000);
  return exp + '.' + sign(exp);
}

function validToken(token) {
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = sign(exp);
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function isAuthed(req) {
  return !APP_PASSWORD || validToken(parseCookies(req).rc_session);
}

function sessionCookie(req, value, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
  return `rc_session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

// Whitelist columns so request bodies can never write arbitrary SQL identifiers.
function pick(obj, fields) {
  const out = {};
  fields.forEach(f => {
    if (obj[f] === undefined) return;
    let v = obj[f];
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (v === '') v = null;
    out[f] = v;
  });
  return out;
}

function insert(table, row) {
  const keys = Object.keys(row);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  return Number(db.prepare(sql).run(...keys.map(k => row[k])).lastInsertRowid);
}

function update(table, id, row) {
  const keys = Object.keys(row);
  const sets = keys.map(k => `${k} = ?`).concat("updated_at = datetime('now')");
  db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...keys.map(k => row[k]), id);
}

function getOr404(table, id) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Not found');
  return row;
}

function requireName(body, what) {
  if (!body.name || !String(body.name).trim()) throw new HttpError(400, what + ' name is required');
}

// Energy lists are stored as JSON: [{ energy_id, qty, per: 'hour' | 'run' | 'day' }]
function cleanEnergy(list) {
  return JSON.stringify((Array.isArray(list) ? list : []).filter(e => e && e.energy_id).map(e => ({
    energy_id: Number(e.energy_id), qty: Number(e.qty) || 0, per: ['run', 'day'].includes(e.per) ? e.per : 'hour',
  })));
}

function parseEnergy(row, key) {
  try { row[key] = JSON.parse(row[key] || '[]'); } catch { row[key] = []; }
  return row;
}

// ---------- data access ----------

const INGREDIENT_FIELDS = ['name', 'category', 'supplier', 'purchase_qty', 'purchase_unit', 'purchase_price', 'yield_pct',
  'density', 'price_date', 'notes', 'active'];
const ENERGY_FIELDS = ['name', 'kind', 'unit', 'pack_label', 'pack_size', 'pack_price', 'price_date', 'notes', 'active'];
const EQUIPMENT_FIELDS = ['name', 'kind', 'purchase_cost', 'salvage_value', 'life_years', 'hours_per_year',
  'maintenance_per_year', 'purchase_date', 'always_on', 'capacity_qty', 'capacity_unit', 'notes', 'active'];
const RECIPE_FIELDS = ['name', 'product', 'code', 'description', 'yield_qty', 'yield_unit', 'density', 'pack_name',
  'pack_qty', 'pack_unit', 'sell_price', 'method', 'notes', 'active'];
const LINE_FIELDS = ['ingredient_id', 'qty', 'unit', 'basis', 'note'];
const STEP_FIELDS = ['label', 'equipment_id', 'hours', 'scaling', 'load_capacity', 'load_unit', 'days', 'store_qty', 'store_unit',
  'labor_hours', 'notes'];

// Defaults for NOT NULL columns, so a blank field in the form doesn't fail the save.
const DEFAULTS = {
  ingredients: { category: 'other', purchase_qty: 1, purchase_unit: 'kg', purchase_price: 0, yield_pct: 100 },
  energy_sources: { kind: 'other', unit: 'kWh', pack_size: 1, pack_price: 0 },
  equipment: { kind: 'other', purchase_cost: 0, salvage_value: 0, life_years: 5, hours_per_year: 500, maintenance_per_year: 0, always_on: 0 },
  recipes: { product: 'other', yield_qty: 1, yield_unit: 'kg' },
};
function withDefaults(table, row) {
  Object.entries(DEFAULTS[table]).forEach(([k, v]) => { if (k in row && row[k] == null) row[k] = v; });
  return row;
}

function saveSimple(table, fields, body, id, extra) {
  const row = withDefaults(table, pick(body, fields));
  if (extra) Object.assign(row, extra(body));
  if (id) {
    getOr404(table, id);
    if (Object.keys(row).length) update(table, id, row);
  } else {
    Object.entries(DEFAULTS[table]).forEach(([k, v]) => { if (row[k] == null) row[k] = v; });
    id = insert(table, row);
  }
  return id;
}

function equipmentOut(row) { return parseEnergy(row, 'energy_use'); }

function recipeFull(id) {
  const r = getOr404('recipes', id);
  r.lines = db.prepare('SELECT * FROM recipe_lines WHERE recipe_id = ? ORDER BY sort_order, id').all(id);
  r.steps = db.prepare('SELECT * FROM recipe_steps WHERE recipe_id = ? ORDER BY sort_order, id').all(id).map(s => parseEnergy(s, 'energy'));
  return r;
}

function allRecipes() {
  return db.prepare('SELECT id FROM recipes ORDER BY name').all().map(r => recipeFull(r.id));
}

function saveRecipe(body, id) {
  requireName(body, 'Recipe');
  return tx(db, () => {
    id = saveSimple('recipes', RECIPE_FIELDS, body, id);
    if (Array.isArray(body.lines)) {
      db.prepare('DELETE FROM recipe_lines WHERE recipe_id = ?').run(id);
      body.lines.forEach((l, i) => {
        if (!l.ingredient_id) return;
        const row = pick(l, LINE_FIELDS);
        if (!db.prepare('SELECT 1 FROM ingredients WHERE id = ?').get(row.ingredient_id)) throw new HttpError(400, 'Unknown ingredient in recipe');
        Object.assign(row, { recipe_id: id, sort_order: i, qty: Number(row.qty) || 0, unit: row.unit || 'g', basis: row.basis === 'per_pack' ? 'per_pack' : 'batch' });
        insert('recipe_lines', row);
      });
    }
    if (Array.isArray(body.steps)) {
      db.prepare('DELETE FROM recipe_steps WHERE recipe_id = ?').run(id);
      body.steps.forEach((s, i) => {
        const row = pick(s, STEP_FIELDS);
        if (row.equipment_id && !db.prepare('SELECT 1 FROM equipment WHERE id = ?').get(row.equipment_id)) throw new HttpError(400, 'Unknown equipment in recipe');
        Object.assign(row, {
          recipe_id: id, sort_order: i, hours: Number(row.hours) || 0, labor_hours: Number(row.labor_hours) || 0,
          scaling: ['fixed', 'linear', 'loads', 'storage'].includes(row.scaling) ? row.scaling : 'fixed', energy: cleanEnergy(s.energy),
        });
        insert('recipe_steps', row);
      });
    }
    return recipeFull(id);
  });
}

// Names of recipes (or equipment) that use something, so we can refuse to delete it.
function usedBy(kind, id) {
  if (kind === 'ingredient') {
    return db.prepare(`SELECT DISTINCT r.name FROM recipe_lines l JOIN recipes r ON r.id = l.recipe_id
      WHERE l.ingredient_id = ? ORDER BY r.name`).all(id).map(r => r.name);
  }
  if (kind === 'equipment') {
    return db.prepare(`SELECT DISTINCT r.name FROM recipe_steps s JOIN recipes r ON r.id = s.recipe_id
      WHERE s.equipment_id = ? ORDER BY r.name`).all(id).map(r => r.name);
  }
  const uses = list => list.some(e => Number(e.energy_id) === id);
  const recipes = db.prepare('SELECT s.energy, r.name FROM recipe_steps s JOIN recipes r ON r.id = s.recipe_id').all()
    .filter(s => uses(parseEnergy(s, 'energy').energy)).map(s => s.name);
  const equipment = db.prepare('SELECT name, energy_use FROM equipment').all()
    .filter(e => uses(parseEnergy(e, 'energy_use').energy_use)).map(e => e.name);
  return Array.from(new Set(recipes.concat(equipment))).sort();
}

function remove(table, kind, id) {
  const names = usedBy(kind, id);
  if (names.length) throw new HttpError(409, `Still used by: ${names.join(', ')}. Remove it there first, or untick Active to hide it.`);
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  return { ok: true };
}

function getSettings() {
  const out = {};
  db.prepare('SELECT key, value FROM settings').all().forEach(r => { out[r.key] = r.value; });
  return out;
}

const BACKUP_TABLES = ['settings', 'ingredients', 'energy_sources', 'equipment', 'recipes', 'recipe_lines', 'recipe_steps'];

function backup() {
  const out = { app: 'recipe-costing', version: 1, exported_at: new Date().toISOString() };
  BACKUP_TABLES.forEach(t => { out[t] = db.prepare(`SELECT * FROM ${t}`).all(); });
  return out;
}

function restore(data) {
  if (!data || data.app !== 'recipe-costing') throw new HttpError(400, 'Not a recipe costing backup file');
  const columns = {};
  BACKUP_TABLES.forEach(t => { columns[t] = new Set(db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name)); });
  tx(db, () => {
    db.exec('PRAGMA defer_foreign_keys = ON');
    BACKUP_TABLES.slice().reverse().forEach(t => db.exec(`DELETE FROM ${t}`));
    BACKUP_TABLES.forEach(t => {
      (data[t] || []).forEach(r => {
        const row = {};
        Object.keys(r).forEach(k => { if (columns[t].has(k)) row[k] = r[k]; });
        if (Object.keys(row).length) insert(t, row);
      });
    });
  });
}

// ---------- routes ----------

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '(\\d+)'; }) + '$');
  routes.push({ method, re, keys, handler });
}

route('GET', '/api/auth', req => ({ required: !!APP_PASSWORD, authed: isAuthed(req) }));

route('GET', '/api/bootstrap', () => ({
  settings: getSettings(),
  ingredients: db.prepare('SELECT * FROM ingredients ORDER BY name').all(),
  energy_sources: db.prepare('SELECT * FROM energy_sources ORDER BY name').all(),
  equipment: db.prepare('SELECT * FROM equipment ORDER BY name').all().map(equipmentOut),
  recipes: allRecipes(),
}));

route('PUT', '/api/settings', (req, body) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  tx(db, () => Object.entries(body).forEach(([k, v]) => {
    if (/^[a-z_]{1,64}$/.test(k)) stmt.run(k, v == null ? '' : String(v));
  }));
  return getSettings();
});

route('POST', '/api/ingredients', (req, body) => {
  requireName(body, 'Ingredient');
  return getOr404('ingredients', saveSimple('ingredients', INGREDIENT_FIELDS, body));
});
route('PUT', '/api/ingredients/:id', (req, body, p) => getOr404('ingredients', saveSimple('ingredients', INGREDIENT_FIELDS, body, p.id)));
route('DELETE', '/api/ingredients/:id', (req, body, p) => remove('ingredients', 'ingredient', p.id));

route('POST', '/api/energy', (req, body) => {
  requireName(body, 'Energy source');
  return getOr404('energy_sources', saveSimple('energy_sources', ENERGY_FIELDS, body));
});
route('PUT', '/api/energy/:id', (req, body, p) => getOr404('energy_sources', saveSimple('energy_sources', ENERGY_FIELDS, body, p.id)));
route('DELETE', '/api/energy/:id', (req, body, p) => remove('energy_sources', 'energy', p.id));

const equipmentExtra = body => (body.energy_use !== undefined ? { energy_use: cleanEnergy(body.energy_use) } : {});
route('POST', '/api/equipment', (req, body) => {
  requireName(body, 'Equipment');
  return equipmentOut(getOr404('equipment', saveSimple('equipment', EQUIPMENT_FIELDS, body, null, equipmentExtra)));
});
route('PUT', '/api/equipment/:id', (req, body, p) => equipmentOut(getOr404('equipment', saveSimple('equipment', EQUIPMENT_FIELDS, body, p.id, equipmentExtra))));
route('DELETE', '/api/equipment/:id', (req, body, p) => remove('equipment', 'equipment', p.id));

route('POST', '/api/recipes', (req, body) => saveRecipe(body));
route('GET', '/api/recipes/:id', (req, body, p) => recipeFull(p.id));
route('PUT', '/api/recipes/:id', (req, body, p) => saveRecipe(body, p.id));
route('POST', '/api/recipes/:id/duplicate', (req, body, p) => {
  const src = recipeFull(p.id);
  src.name = src.name + ' (copy)';
  return saveRecipe(src);
});
route('DELETE', '/api/recipes/:id', (req, body, p) => {
  db.prepare('DELETE FROM recipes WHERE id = ?').run(p.id);
  return { ok: true };
});

route('GET', '/api/backup', () => backup());
route('POST', '/api/restore', (req, body) => { restore(body); return { ok: true }; });

// ---------- server ----------

function serveFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api/login' && req.method === 'POST') {
    const body = await readBody(req);
    const ok = APP_PASSWORD && typeof body.password === 'string' && body.password.length === APP_PASSWORD.length
      && crypto.timingSafeEqual(Buffer.from(body.password), Buffer.from(APP_PASSWORD));
    if (!ok) {
      await new Promise(r => setTimeout(r, 600)); // slow down guessing
      return send(res, 401, { error: 'Wrong password' });
    }
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, makeToken(), SESSION_DAYS * 86400) });
  }
  if (pathname === '/api/logout' && req.method === 'POST') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  if (pathname.startsWith('/api/')) {
    if (pathname !== '/api/auth' && !isAuthed(req)) return send(res, 401, { error: 'Login required' });
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(pathname);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = Number(m[i + 1]); });
      const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
      return send(res, 200, await r.handler(req, body, params));
    }
    return send(res, 404, { error: 'Not found' });
  }

  // Static files; anything unknown falls back to the single page app.
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (file.startsWith(PUBLIC_DIR) && fs.existsSync(file) && fs.statSync(file).isFile()) return serveFile(res, file);
  return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) send(res, status, { error: err.message || 'Server error' });
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Recipe costing running on http://localhost:${PORT}`);
    console.log(APP_PASSWORD ? 'Password protection is ON.' : 'No APP_PASSWORD set: anyone who can reach this address can use the app.');
  });
}

module.exports = { server, db };
