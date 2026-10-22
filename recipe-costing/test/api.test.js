'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recipes-test-'));
process.env.DATA_DIR = dir;
process.env.APP_PASSWORD = 'secret';
const { server, db } = require('../server.js');
const C = require('../public/js/costing.js');

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

test('starter data is seeded and costs without warnings', async () => {
  const { body } = await call('GET', '/api/bootstrap');
  assert.equal(body.settings.company_name, 'Black Belly Smokers');
  assert.ok(body.ingredients.length > 10);
  assert.equal(body.energy_sources.length, 5);
  assert.ok(body.equipment.every(e => Array.isArray(e.energy_use)));
  assert.equal(body.recipes.length, 3);
  const byId = list => Object.fromEntries(list.map(x => [x.id, x]));
  body.recipes.forEach(r => {
    const res = C.computeRecipe({ recipe: r, ingredientsById: byId(body.ingredients), equipmentById: byId(body.equipment),
      energyById: byId(body.energy_sources), settings: body.settings });
    assert.deepEqual(res.warnings, [], r.name);
    assert.ok(res.totals.total > 0 && res.totals.energy > 0 && res.totals.equipment > 0 && res.packs > 0, r.name);
  });
});

test('recipe save, duplicate and delete', async () => {
  const ing = (await call('POST', '/api/ingredients', { name: 'Test pepper', purchase_qty: 1, purchase_unit: 'kg', purchase_price: 10 })).body;
  const en = (await call('POST', '/api/energy', { name: 'Test gas', unit: 'lb', pack_size: 20, pack_price: 40 })).body;
  const eq = (await call('POST', '/api/equipment', { name: 'Test burner', purchase_cost: 100, energy_use: [{ energy_id: en.id, qty: 1, per: 'hour' }, { qty: 3 }] })).body;
  assert.deepEqual(eq.energy_use, [{ energy_id: en.id, qty: 1, per: 'hour' }]);
  assert.equal(eq.life_years, 5);
  const r = (await call('POST', '/api/recipes', {
    name: 'Test sauce', yield_qty: 2, yield_unit: 'L', density: '',
    lines: [{ ingredient_id: ing.id, qty: 500, unit: 'g' }, { ingredient_id: '', qty: 1 }],
    steps: [{ label: 'Cook', equipment_id: eq.id, hours: 1, scaling: 'bogus', energy: [{ energy_id: en.id, qty: '2', per: 'run' }] }],
  })).body;
  assert.equal(r.lines.length, 1);
  assert.equal(r.density, null);
  assert.equal(r.steps[0].scaling, 'fixed');
  assert.deepEqual(r.steps[0].energy, [{ energy_id: en.id, qty: 2, per: 'run' }]);

  const upd = (await call('PUT', '/api/recipes/' + r.id, { name: 'Test sauce 2', yield_qty: '', lines: [] })).body;
  assert.equal(upd.name, 'Test sauce 2');
  assert.equal(upd.yield_qty, 1);
  assert.equal(upd.lines.length, 0);
  assert.equal(upd.steps.length, 1, 'steps are kept when not sent');

  assert.equal((await call('POST', '/api/recipes', { name: 'x', lines: [{ ingredient_id: 99999, qty: 1 }] })).status, 400);
  assert.equal((await call('POST', '/api/recipes', { name: ' ' })).status, 400);

  const copy = (await call('POST', `/api/recipes/${r.id}/duplicate`)).body;
  assert.equal(copy.name, 'Test sauce 2 (copy)');
  assert.equal(copy.steps.length, 1);

  // Things in use can't be deleted
  const blocked = await call('DELETE', '/api/equipment/' + eq.id);
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.error, /Test sauce 2/);
  assert.equal((await call('DELETE', '/api/energy/' + en.id)).status, 409);

  await call('DELETE', '/api/recipes/' + r.id);
  await call('DELETE', '/api/recipes/' + copy.id);
  assert.equal((await call('DELETE', '/api/equipment/' + eq.id)).status, 200);
  assert.equal((await call('DELETE', '/api/energy/' + en.id)).status, 200);
  assert.equal((await call('DELETE', '/api/ingredients/' + ing.id)).status, 200);
});

test('ingredient in a recipe cannot be deleted', async () => {
  const { body } = await call('GET', '/api/bootstrap');
  const used = body.recipes[0].lines[0].ingredient_id;
  const res = await call('DELETE', '/api/ingredients/' + used);
  assert.equal(res.status, 409);
});

test('settings save', async () => {
  const s = (await call('PUT', '/api/settings', { labor_rate: '18.5', 'bad key': 'x' })).body;
  assert.equal(s.labor_rate, '18.5');
  assert.equal(s['bad key'], undefined);
});

test('backup and restore round trip', async () => {
  const before = (await call('GET', '/api/backup')).body;
  await call('POST', '/api/ingredients', { name: 'Temporary' });
  assert.equal((await call('POST', '/api/restore', { app: 'fence-estimator' })).status, 400);
  assert.equal((await call('POST', '/api/restore', before)).status, 200);
  const after = (await call('GET', '/api/bootstrap')).body;
  assert.ok(!after.ingredients.some(i => i.name === 'Temporary'));
  assert.equal(after.recipes.length, 3);
  assert.ok(after.recipes[1].steps[1].energy.length > 0);
});
