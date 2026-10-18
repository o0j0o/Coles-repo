'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { open, tx } = require('./lib/db');
const sketchReader = require('./lib/sketch-reader');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
// Browser libraries served straight from node_modules (no build step).
const VENDOR = {
  'pdf.min.mjs': path.join(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.min.mjs'),
  'pdf.worker.min.mjs': path.join(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs'),
};
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('fence:' + APP_PASSWORD).digest('hex');
const SESSION_DAYS = 30;
const MAX_BODY = 20 * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = open(DATA_DIR);

// ---------- helpers ----------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
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
      if (size > MAX_BODY) { reject(new HttpError(413, 'Upload too large')); req.destroy(); return; }
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
  return !APP_PASSWORD || validToken(parseCookies(req).fs_session);
}

function sessionCookie(req, value, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
  return `fs_session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
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

function update(table, id, row, touch = true) {
  const keys = Object.keys(row);
  if (!keys.length && !touch) return;
  const sets = keys.map(k => `${k} = ?`);
  if (touch) sets.push("updated_at = datetime('now')");
  db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...keys.map(k => row[k]), id);
}

function getOr404(table, id) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Not found');
  return row;
}

// ---------- data access ----------

const SUPPLIER_FIELDS = ['name', 'contact_name', 'phone', 'email', 'address', 'website', 'account_number',
  'payment_terms', 'delivery_notes', 'notes', 'active'];
const MATERIAL_FIELDS = ['name', 'category', 'material_type', 'sku', 'description', 'size', 'length', 'width',
  'height', 'thickness', 'dim_unit', 'color', 'grade', 'unit', 'pack_size', 'sell_price', 'markup_pct', 'waste_pct',
  'taxable', 'stock_qty', 'reorder_level', 'notes', 'active'];
const PRICE_FIELDS = ['supplier_id', 'supplier_sku', 'cost', 'lead_time_days', 'min_order_qty', 'preferred', 'price_date', 'notes'];
const FENCE_FIELDS = ['name', 'style', 'material_type', 'default_height', 'post_spacing', 'labor_price_per_ft',
  'labor_cost_per_ft', 'labor_price_per_gate', 'labor_cost_per_gate', 'default_gate_material_id', 'description', 'active'];
const COMPONENT_FIELDS = ['label', 'category', 'material_id', 'rule', 'qty', 'waste_pct', 'notes', 'sort_order'];

function materialsWithPrices(where = '', params = []) {
  const mats = db.prepare(`SELECT * FROM materials ${where} ORDER BY category, name`).all(...params);
  const prices = db.prepare(`SELECT p.*, s.name AS supplier_name FROM material_prices p
    JOIN suppliers s ON s.id = p.supplier_id ORDER BY p.preferred DESC, p.cost`).all();
  const byMat = {};
  prices.forEach(p => { (byMat[p.material_id] = byMat[p.material_id] || []).push(p); });
  mats.forEach(m => { m.prices = byMat[m.id] || []; });
  return mats;
}

function savePrices(materialId, prices) {
  db.prepare('DELETE FROM material_prices WHERE material_id = ?').run(materialId);
  (prices || []).forEach(p => {
    if (!p.supplier_id) return;
    const row = pick(p, PRICE_FIELDS);
    row.material_id = materialId;
    row.cost = Number(row.cost) || 0;
    row.preferred = row.preferred ? 1 : 0;
    insert('material_prices', row);
  });
}

function saveMaterial(body, id) {
  if (!body.name || !String(body.name).trim()) throw new HttpError(400, 'Material name is required');
  return tx(db, () => {
    const row = pick(body, MATERIAL_FIELDS);
    if (row.pack_size == null) row.pack_size = 1;
    if (row.waste_pct == null) row.waste_pct = 0;
    if (!row.unit) row.unit = 'each';
    if (!row.category) row.category = 'other';
    if (id) { getOr404('materials', id); update('materials', id, row); } else id = insert('materials', row);
    if (body.prices) savePrices(id, body.prices);
    return materialsWithPrices('WHERE id = ?', [id])[0];
  });
}

function fenceTypeWithComponents(id) {
  const ft = getOr404('fence_types', id);
  ft.components = db.prepare('SELECT * FROM fence_type_components WHERE fence_type_id = ? ORDER BY sort_order, id').all(id);
  return ft;
}

function saveFenceType(body, id) {
  if (!body.name || !String(body.name).trim()) throw new HttpError(400, 'Fence type name is required');
  return tx(db, () => {
    const row = pick(body, FENCE_FIELDS);
    if (id) { getOr404('fence_types', id); update('fence_types', id, row); } else id = insert('fence_types', row);
    if (Array.isArray(body.components)) {
      // Keep component ids stable so saved estimate overrides still line up.
      const existing = new Set(db.prepare('SELECT id FROM fence_type_components WHERE fence_type_id = ?').all(id).map(r => r.id));
      const keep = new Set();
      body.components.forEach((c, i) => {
        const r = pick(c, COMPONENT_FIELDS);
        r.sort_order = i;
        if (r.qty == null) r.qty = 0;
        if (!r.rule) r.rule = 'per_ft';
        if (!r.category) r.category = 'other';
        if (c.id && existing.has(Number(c.id))) {
          update('fence_type_components', Number(c.id), r, false);
          keep.add(Number(c.id));
        } else {
          r.fence_type_id = id;
          keep.add(insert('fence_type_components', r));
        }
      });
      existing.forEach(cid => { if (!keep.has(cid)) db.prepare('DELETE FROM fence_type_components WHERE id = ?').run(cid); });
    }
    return fenceTypeWithComponents(id);
  });
}

function getSettings() {
  const out = {};
  db.prepare('SELECT key, value FROM settings').all().forEach(r => { out[r.key] = r.value; });
  return out;
}

function nextEstimateNumber() {
  const s = getSettings();
  const n = parseInt(s.next_estimate_number || '1001', 10);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('next_estimate_number', ?)").run(String(n + 1));
  return (s.estimate_prefix || '') + n;
}

function estimateOut(row) {
  const data = JSON.parse(row.data || '{}');
  return Object.assign({}, data, {
    id: row.id, number: row.number, status: row.status, customer_name: row.customer_name,
    customer_phone: row.customer_phone, customer_email: row.customer_email, site_address: row.site_address,
    fence_type_id: row.fence_type_id, total: row.total, fence_length: row.fence_length,
    created_at: row.created_at, updated_at: row.updated_at,
  });
}

const ESTIMATE_COLS = ['status', 'customer_name', 'customer_phone', 'customer_email', 'site_address', 'fence_type_id'];

function saveEstimate(body, id) {
  const row = pick(body, ESTIMATE_COLS);
  const data = Object.assign({}, body);
  ['id', 'number', 'total', 'fence_length', 'created_at', 'updated_at'].concat(ESTIMATE_COLS).forEach(k => delete data[k]);
  row.data = JSON.stringify(data);
  row.total = Number(body.result && body.result.totals && body.result.totals.total) || 0;
  row.fence_length = Number(body.result && body.result.geometry && body.result.geometry.fenceLength) || 0;
  return tx(db, () => {
    if (id) {
      getOr404('estimates', id);
      update('estimates', id, row);
    } else {
      row.number = nextEstimateNumber();
      if (!row.status) row.status = 'draft';
      id = insert('estimates', row);
    }
    return estimateOut(getOr404('estimates', id));
  });
}

function saveUpload(body) {
  const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(body.dataUrl || '');
  if (!m) throw new HttpError(400, 'Expected a PNG, JPEG or WebP image');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(m[2], 'base64'));
  return { url: '/uploads/' + name };
}

const BACKUP_TABLES = ['settings', 'suppliers', 'materials', 'material_prices', 'fence_types', 'fence_type_components', 'estimates'];

function backup() {
  const out = { app: 'fence-estimator', version: 1, exported_at: new Date().toISOString() };
  BACKUP_TABLES.forEach(t => { out[t] = db.prepare(`SELECT * FROM ${t}`).all(); });
  return out;
}

function restore(data) {
  if (!data || data.app !== 'fence-estimator') throw new HttpError(400, 'Not a fence estimator backup file');
  const columns = {};
  BACKUP_TABLES.forEach(t => { columns[t] = new Set(db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name)); });
  tx(db, () => {
    db.exec('PRAGMA defer_foreign_keys = ON');
    BACKUP_TABLES.slice().reverse().forEach(t => db.exec(`DELETE FROM ${t}`));
    BACKUP_TABLES.forEach(t => {
      (data[t] || []).forEach(r => {
        const row = {};
        Object.keys(r).forEach(k => { if (columns[t].has(k)) row[k] = r[k]; });
        if (Object.keys(row).length) {
          const keys = Object.keys(row);
          db.prepare(`INSERT INTO ${t} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map(k => row[k]));
        }
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

route('POST', '/api/read-sketch', async (req, body) => {
  if (!sketchReader.enabled()) throw new HttpError(400, 'Sketch reading is not set up. Add ANTHROPIC_API_KEY on the server.');
  const m = /^\/uploads\/([a-f0-9]+\.(jpg|png|webp))$/.exec(body.url || '');
  if (!m) throw new HttpError(400, 'Upload the sketch first');
  const file = path.join(UPLOAD_DIR, m[1]);
  if (!fs.existsSync(file)) throw new HttpError(404, 'Sketch image not found');
  const type = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[m[2]];
  try {
    return await sketchReader.readSketch(fs.readFileSync(file), type, getSettings().length_unit === 'm' ? 'm' : 'ft');
  } catch (err) {
    throw new HttpError(502, err.message);
  }
});

route('GET', '/api/bootstrap', () => ({
  features: { sketch_reader: sketchReader.enabled() },
  settings: getSettings(),
  suppliers: db.prepare('SELECT * FROM suppliers ORDER BY name').all(),
  materials: materialsWithPrices(),
  fence_types: db.prepare('SELECT * FROM fence_types ORDER BY name').all().map(f => fenceTypeWithComponents(f.id)),
}));

route('GET', '/api/settings', () => getSettings());
route('PUT', '/api/settings', (req, body) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  tx(db, () => Object.entries(body).forEach(([k, v]) => {
    if (/^[a-z_]{1,64}$/.test(k)) stmt.run(k, v == null ? '' : String(v));
  }));
  return getSettings();
});

route('GET', '/api/suppliers', () => db.prepare('SELECT * FROM suppliers ORDER BY name').all());
route('POST', '/api/suppliers', (req, body) => {
  if (!body.name) throw new HttpError(400, 'Supplier name is required');
  return getOr404('suppliers', insert('suppliers', pick(body, SUPPLIER_FIELDS)));
});
route('PUT', '/api/suppliers/:id', (req, body, p) => {
  getOr404('suppliers', p.id);
  update('suppliers', p.id, pick(body, SUPPLIER_FIELDS));
  return getOr404('suppliers', p.id);
});
route('DELETE', '/api/suppliers/:id', (req, body, p) => {
  db.prepare('DELETE FROM suppliers WHERE id = ?').run(p.id);
  return { ok: true };
});

route('GET', '/api/materials', () => materialsWithPrices());
route('POST', '/api/materials', (req, body) => saveMaterial(body));
route('POST', '/api/materials/bulk', (req, body) => {
  const items = Array.isArray(body.items) ? body.items : [];
  const results = { created: 0, updated: 0 };
  tx(db, () => items.forEach(item => {
    const existing = item.id ? db.prepare('SELECT id FROM materials WHERE id = ?').get(item.id)
      : (item.sku ? db.prepare('SELECT id FROM materials WHERE sku = ?').get(item.sku) : null);
    const row = pick(item, MATERIAL_FIELDS);
    let id;
    if (existing) {
      id = existing.id;
      update('materials', id, row);
      results.updated++;
    } else {
      if (!row.name) return;
      if (!row.unit) row.unit = 'each';
      if (!row.category) row.category = 'other';
      row.pack_size = row.pack_size || 1;
      row.waste_pct = row.waste_pct || 0;
      id = insert('materials', row);
      results.created++;
    }
    if (item.supplier_id && item.cost != null) {
      const price = db.prepare('SELECT id FROM material_prices WHERE material_id = ? AND supplier_id = ?').get(id, item.supplier_id);
      if (price) {
        db.prepare("UPDATE material_prices SET cost = ?, supplier_sku = COALESCE(?, supplier_sku), price_date = date('now') WHERE id = ?")
          .run(Number(item.cost) || 0, item.supplier_sku || null, price.id);
      } else {
        const hasPreferred = db.prepare('SELECT 1 FROM material_prices WHERE material_id = ? AND preferred = 1').get(id);
        insert('material_prices', { material_id: id, supplier_id: item.supplier_id, cost: Number(item.cost) || 0,
          preferred: hasPreferred ? 0 : 1, supplier_sku: item.supplier_sku || null, price_date: new Date().toISOString().slice(0, 10) });
      }
    }
  }));
  return results;
});
route('GET', '/api/materials/:id', (req, body, p) => {
  const m = materialsWithPrices('WHERE id = ?', [p.id])[0];
  if (!m) throw new HttpError(404, 'Not found');
  return m;
});
route('PUT', '/api/materials/:id', (req, body, p) => saveMaterial(body, p.id));
route('DELETE', '/api/materials/:id', (req, body, p) => {
  db.prepare('DELETE FROM materials WHERE id = ?').run(p.id);
  return { ok: true };
});

route('GET', '/api/fence-types', () => db.prepare('SELECT * FROM fence_types ORDER BY name').all().map(f => fenceTypeWithComponents(f.id)));
route('POST', '/api/fence-types', (req, body) => saveFenceType(body));
route('GET', '/api/fence-types/:id', (req, body, p) => fenceTypeWithComponents(p.id));
route('PUT', '/api/fence-types/:id', (req, body, p) => saveFenceType(body, p.id));
route('DELETE', '/api/fence-types/:id', (req, body, p) => {
  db.prepare('DELETE FROM fence_types WHERE id = ?').run(p.id);
  return { ok: true };
});

route('GET', '/api/estimates', () => db.prepare(`SELECT e.id, e.number, e.status, e.customer_name, e.site_address,
  e.total, e.fence_length, e.created_at, e.updated_at, f.name AS fence_type_name
  FROM estimates e LEFT JOIN fence_types f ON f.id = e.fence_type_id ORDER BY e.updated_at DESC`).all());
route('POST', '/api/estimates', (req, body) => saveEstimate(body));
route('GET', '/api/estimates/:id', (req, body, p) => estimateOut(getOr404('estimates', p.id)));
route('PUT', '/api/estimates/:id', (req, body, p) => saveEstimate(body, p.id));
route('POST', '/api/estimates/:id/duplicate', (req, body, p) => {
  const src = estimateOut(getOr404('estimates', p.id));
  delete src.id;
  src.status = 'draft';
  src.customer_name = (src.customer_name || '') + ' (copy)';
  return saveEstimate(src);
});
route('DELETE', '/api/estimates/:id', (req, body, p) => {
  db.prepare('DELETE FROM estimates WHERE id = ?').run(p.id);
  return { ok: true };
});

route('POST', '/api/uploads', (req, body) => saveUpload(body));
route('GET', '/api/backup', () => backup());
route('POST', '/api/restore', (req, body) => { restore(body); return { ok: true }; });

// ---------- server ----------

function serveFile(res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': cache || 'no-cache',
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

  if (pathname.startsWith('/uploads/')) {
    if (!isAuthed(req)) return send(res, 401, 'Login required');
    const name = path.basename(pathname);
    return serveFile(res, path.join(UPLOAD_DIR, name), 'private, max-age=31536000, immutable');
  }

  if (pathname.startsWith('/vendor/pdfjs/')) {
    const file = VENDOR[pathname.slice('/vendor/pdfjs/'.length)];
    return file ? serveFile(res, file, 'public, max-age=604800') : send(res, 404, 'Not found');
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
    console.log(`Fence estimator running on http://localhost:${PORT}`);
    console.log(APP_PASSWORD ? 'Password protection is ON.' : 'No APP_PASSWORD set: anyone who can reach this address can use the app.');
  });
}

module.exports = { server, db };
