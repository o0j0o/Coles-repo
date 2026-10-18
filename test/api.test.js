'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fence-test-'));
process.env.DATA_DIR = dir;
process.env.APP_PASSWORD = 'secret';
const { server, db } = require('../server.js');

let base;
let cookie = '';
async function call(method, url, body) {
  const res = await fetch(base + url, {
    method, headers: Object.assign({ cookie }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: res.status, body: await res.json().catch(() => null) };
}

test.before(() => new Promise(r => server.listen(0, () => { base = 'http://localhost:' + server.address().port; r(); })));
test.after(() => { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('password protects the API', async () => {
  assert.equal((await call('GET', '/api/bootstrap')).status, 401);
  assert.equal((await call('POST', '/api/login', { password: 'nope' })).status, 401);
  assert.equal((await call('POST', '/api/login', { password: 'secret' })).status, 200);
  assert.equal((await call('GET', '/api/bootstrap')).status, 200);
});

test('starter data is seeded', async () => {
  const { body } = await call('GET', '/api/bootstrap');
  assert.ok(body.materials.length > 10);
  assert.ok(body.fence_types.length >= 4);
  assert.ok(body.fence_types[0].components.length > 0);
  assert.equal(body.settings.tax_rate, '17.5');
});

test('material CRUD with supplier prices', async () => {
  const sup = (await call('POST', '/api/suppliers', { name: 'Test Supply' })).body;
  const m = (await call('POST', '/api/materials', {
    name: 'Test Post', category: 'post', unit: 'each', prices: [{ supplier_id: sup.id, cost: 12.5, preferred: true, supplier_sku: 'TP-1' }],
  })).body;
  assert.equal(m.prices.length, 1);
  assert.equal(m.prices[0].supplier_name, 'Test Supply');
  const upd = (await call('PUT', '/api/materials/' + m.id, { name: 'Test Post 2', sell_price: 20, prices: [] })).body;
  assert.equal(upd.name, 'Test Post 2');
  assert.equal(upd.prices.length, 0);
  assert.equal((await call('POST', '/api/materials', { name: '' })).status, 400);
  await call('DELETE', '/api/materials/' + m.id);
  assert.equal((await call('GET', '/api/materials/' + m.id)).status, 404);
});

test('fence type components keep their ids on save', async () => {
  const ft = (await call('POST', '/api/fence-types', { name: 'T', components: [{ label: 'a', rule: 'per_post', qty: 1 }, { label: 'b', rule: 'per_ft', qty: 2 }] })).body;
  const [a, b] = ft.components;
  const ft2 = (await call('PUT', '/api/fence-types/' + ft.id, { name: 'T', components: [{ id: b.id, label: 'b2', rule: 'per_ft', qty: 3 }] })).body;
  assert.equal(ft2.components.length, 1);
  assert.equal(ft2.components[0].id, b.id);
  assert.notEqual(ft2.components[0].id, a.id);
});

test('estimates save with numbers and duplicate', async () => {
  const e = (await call('POST', '/api/estimates', { customer_name: 'Jane', manual_runs: [{ length: 50 }], result: { totals: { total: 1234.5 }, geometry: { fenceLength: 50 } } })).body;
  assert.match(e.number, /^Q-\d+$/);
  assert.equal(e.total, 1234.5);
  assert.deepEqual(e.manual_runs, [{ length: 50 }]);
  const d = (await call('POST', `/api/estimates/${e.id}/duplicate`)).body;
  assert.notEqual(d.number, e.number);
  const list = (await call('GET', '/api/estimates')).body;
  assert.equal(list.length, 2);
});

test('backup and restore round trip', async () => {
  const before = (await call('GET', '/api/backup')).body;
  await call('POST', '/api/suppliers', { name: 'Temporary' });
  assert.equal((await call('POST', '/api/restore', before)).status, 200);
  const sups = (await call('GET', '/api/suppliers')).body;
  assert.ok(!sups.some(s => s.name === 'Temporary'));
  assert.equal((await call('GET', '/api/estimates')).body.length, 2);
});

test('uploads accept images only', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const r = await call('POST', '/api/uploads', { dataUrl: png });
  assert.match(r.body.url, /^\/uploads\/[a-f0-9]+\.png$/);
  assert.equal((await call('POST', '/api/uploads', { dataUrl: 'data:text/html;base64,PGgxPg==' })).status, 400);
});
