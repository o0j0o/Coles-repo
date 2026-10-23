'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recipes-test-'));
process.env.DATA_DIR = dir;
process.env.APP_PASSWORD = 'secret';
process.env.ANTHROPIC_API_KEY = 'test-key';
const { server, db } = require('../server.js');
const reader = require('../lib/recipe-reader.js');
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

test('fridge storage steps save and older databases are upgraded', async () => {
  const fr = (await call('POST', '/api/equipment', { name: 'Walk-in', always_on: true, capacity_qty: 300, capacity_unit: 'kg', purchase_date: '2025-03-01' })).body;
  assert.equal(fr.always_on, 1);
  assert.equal(fr.capacity_unit, 'kg');
  const r = (await call('POST', '/api/recipes', { name: 'Pastrami', yield_qty: 4, yield_unit: 'kg',
    steps: [{ label: 'Cure', equipment_id: fr.id, scaling: 'storage', days: 7, store_qty: 6, store_unit: 'kg', energy: [{ energy_id: 1, qty: 3, per: 'day' }] }] })).body;
  assert.equal(r.steps[0].scaling, 'storage');
  assert.equal(r.steps[0].days, 7);
  assert.equal(r.steps[0].energy[0].per, 'day');

  // Burn rates by temperature are kept on equipment, and a blank step amount means "follow the temperature".
  const sm = (await call('POST', '/api/equipment', { name: 'Smoker', energy_use: [{ energy_id: 1, qty: 2, per: 'hour',
    rates: [{ temp: 400, qty: 3.5 }, { temp: 225, qty: '1.5' }, { temp: '', qty: 9 }] }] })).body;
  assert.deepEqual(sm.energy_use[0].rates, [{ temp: 225, qty: 1.5 }, { temp: 400, qty: 3.5 }]);
  const hot = (await call('POST', '/api/recipes', { name: 'Hot', steps: [{ equipment_id: sm.id, hours: 1, temp: 400,
    energy: [{ energy_id: 1, qty: '', per: 'hour' }] }] })).body;
  assert.equal(hot.steps[0].temp, 400);
  assert.equal(hot.steps[0].energy[0].qty, null);
  await call('DELETE', '/api/recipes/' + hot.id);
  await call('DELETE', '/api/equipment/' + sm.id);
  await call('DELETE', '/api/recipes/' + r.id);
  await call('DELETE', '/api/equipment/' + fr.id);

  // A database from before these columns existed gets them added on open.
  const { DatabaseSync } = require('node:sqlite');
  const old = fs.mkdtempSync(path.join(os.tmpdir(), 'recipes-old-'));
  const raw = new DatabaseSync(path.join(old, 'recipes.db'));
  raw.exec(`CREATE TABLE equipment (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE recipe_steps (id INTEGER PRIMARY KEY, recipe_id INTEGER);
    CREATE TABLE ingredients (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO ingredients (name) VALUES ('x');`);
  raw.close();
  const upgraded = require('../lib/db').open(old);
  const cols = t => upgraded.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  assert.ok(cols('equipment').includes('always_on') && cols('equipment').includes('capacity_unit'));
  assert.ok(cols('recipe_steps').includes('days') && cols('recipe_steps').includes('store_unit'));
  upgraded.close();
  fs.rmSync(old, { recursive: true, force: true });
});

test('reading a recipe saves the original pages and keeps them with the recipe', async () => {
  let seen;
  reader._setClient({ beta: { messages: { create: async req => {
    seen = req;
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({
      name: 'Read sauce', product: 'pepper sauce', description: '', yield_qty: 2, yield_unit: 'L', pack_name: '', pack_qty: 0, pack_unit: '',
      ingredients: [{ name: 'Garlic', qty: 50, unit: 'g', note: '', category: 'produce', per_pack: false, match_id: 3 }],
      steps: [], method: 'Blend.', notes: '' }) }] };
  } } } });
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const res = await call('POST', '/api/read-recipe', { files: [{ name: 'page1.png', dataUrl: png }] });
  assert.equal(res.status, 200);
  assert.equal(res.body.recipe.name, 'Read sauce');
  assert.match(seen.messages[0].content[1].text, /Garlic/);
  const src = res.body.sources[0];
  assert.match(src.url, /^\/uploads\/[a-f0-9]{24}\.png$/);
  assert.equal((await fetch(base + src.url, { headers: { cookie } })).status, 200);
  assert.equal((await fetch(base + src.url)).status, 401, 'pages need a login');

  const saved = (await call('POST', '/api/recipes', { name: 'Read sauce', source_files: [src, { url: '/etc/passwd', name: 'x' }] })).body;
  assert.deepEqual(saved.source_files, [{ url: src.url, name: 'page1.png' }]);
  await call('DELETE', '/api/recipes/' + saved.id);

  assert.equal((await call('POST', '/api/read-recipe', {})).status, 400);
  assert.equal((await call('POST', '/api/read-recipe', { files: [{ dataUrl: 'data:text/html;base64,PGgxPg==' }] })).status, 400);
  assert.equal((await call('GET', '/api/bootstrap')).body.features.recipe_reader, true);
});

test('the old sample pellet smoker is upgraded to the Ironwood XL figures, unless it was edited', () => {
  const { open } = require('../lib/db');
  const oldUse = pellets => JSON.stringify([{ energy_id: 4, qty: pellets, per: 'hour',
    rates: [[180, 1], [225, 1.5], [275, 2], [350, 2.75], [400, 3.5]].map(([temp, qty]) => ({ temp, qty })) },
    { energy_id: 1, qty: 0.3, per: 'hour' }]);
  const make = pellets => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'recipes-up-'));
    const first = open(d);
    first.prepare("UPDATE equipment SET name = 'Pellet smoker', energy_use = ? WHERE name = 'Traeger Ironwood XL'").run(oldUse(pellets));
    first.close();
    const again = open(d);
    const rows = again.prepare("SELECT name, energy_use FROM equipment WHERE name IN ('Pellet smoker', 'Traeger Ironwood XL')").all();
    again.close();
    fs.rmSync(d, { recursive: true, force: true });
    return rows;
  };
  const upgraded = make(2);
  assert.equal(upgraded[0].name, 'Traeger Ironwood XL');
  const use = JSON.parse(upgraded[0].energy_use);
  assert.equal(use[0].qty, 1.25);
  assert.deepEqual(use[0].rates.find(r => r.temp === 225), { temp: 225, qty: 0.95 });
  assert.equal(use[0].energy_id, 4, 'keeps the pellets it points at');
  const edited = make(1.8);
  assert.equal(edited[0].name, 'Pellet smoker', 'an edited smoker is left alone');
  assert.equal(JSON.parse(edited[0].energy_use)[0].qty, 1.8);
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
  assert.ok(after.recipes[1].steps[2].energy.length > 0);
  assert.equal(after.recipes[1].steps[1].scaling, 'storage');
});
