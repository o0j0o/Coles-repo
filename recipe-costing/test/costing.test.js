'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/js/costing.js');

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

const ings = {
  1: { id: 1, name: 'Beef', category: 'meat', purchase_qty: 1, purchase_unit: 'kg', purchase_price: 30, yield_pct: 80 },
  2: { id: 2, name: 'Salt', category: 'salt', purchase_qty: 1, purchase_unit: 'kg', purchase_price: 2, yield_pct: 100, density: 1.2 },
  3: { id: 3, name: 'Vinegar', category: 'vinegar', purchase_qty: 1, purchase_unit: 'gal', purchase_price: 15.14, yield_pct: 100 },
  4: { id: 4, name: 'Bottle', category: 'packaging', purchase_qty: 24, purchase_unit: 'each', purchase_price: 36 },
};
const ens = {
  1: { id: 1, name: 'Electricity', unit: 'kWh', pack_size: 1, pack_price: 0.8 },
  2: { id: 2, name: 'Charcoal', unit: 'lb', pack_size: 20, pack_price: 30 },
};
const eqs = {
  1: { id: 1, name: 'Smoker', purchase_cost: 2100, salvage_value: 100, life_years: 5, hours_per_year: 400, maintenance_per_year: 200 },
};

function run(recipe, scale, settings) {
  return C.computeRecipe({ recipe, scale, ingredientsById: ings, equipmentById: eqs, energyById: ens, settings: settings || { labor_rate: 10, target_margin_pct: 50 } });
}

test('unit conversions', () => {
  near(C.convert(1, 'lb', 'g'), 453.59237);
  near(C.convert(1, 'gal', 'L'), 3.785411784);
  near(C.convert(3, 'tsp', 'tbsp'), 1);
  near(C.convert(100, 'g', 'ml', 0.5), 200);
  near(C.convert(1, 'L', 'kg', 0.95), 0.95);
  assert.ok(Number.isNaN(C.convert(1, 'kg', 'L')), 'needs density');
  assert.ok(Number.isNaN(C.convert(1, 'kg', 'each')));
});

test('tidy and alt pick friendly units', () => {
  assert.deepEqual(C.tidy(2500, 'g'), { qty: 2.5, unit: 'kg' });
  assert.equal(C.tidy(0.5, 'kg').unit, 'g');
  near(C.tidy(9, 'tsp').qty, 3);
  assert.equal(C.alt(1, 'kg').unit, 'lb');
  assert.equal(C.alt(100, 'g').unit, 'oz');
  assert.equal(C.alt(2, 'lb').unit, 'g');
  assert.equal(C.alt(3, 'each'), null);
});

test('ingredient cost allows for trim loss and density', () => {
  near(C.ingredientCost(ings[1], 1, 'kg'), 37.5); // 30 / 0.8
  near(C.ingredientCost(ings[2], 100, 'ml'), 0.24); // 120 g of salt
  assert.ok(Number.isNaN(C.ingredientCost(ings[1], 1, 'L')));
});

test('equipment hourly cost spreads price over working life', () => {
  // (2100 - 100) / (5 * 400) = 1.00 wear, 200 / 400 = 0.50 upkeep
  near(C.equipmentHourlyCost(eqs[1]), 1.5);
  assert.equal(C.equipmentHourlyCost({ purchase_cost: 100 }), 0);
});

const sauce = {
  yield_qty: 3, yield_unit: 'L', density: 1, pack_qty: 150, pack_unit: 'ml', pack_name: 'bottle', sell_price: 10,
  lines: [
    { ingredient_id: 3, qty: 2, unit: 'L', basis: 'batch' },
    { ingredient_id: 2, qty: 50, unit: 'g', basis: 'batch' },
    { ingredient_id: 4, qty: 1, unit: 'each', basis: 'per_pack' },
  ],
  steps: [
    { label: 'Cook', hours: 1, scaling: 'fixed', energy: [{ energy_id: 1, qty: 2, per: 'hour' }], labor_hours: 1 },
    { label: 'Bottle', hours: 0, scaling: 'linear', energy: [], labor_hours: 0.5 },
  ],
};

test('base batch: packs, ingredient, packaging, energy and labour costs', () => {
  const r = run(sauce);
  assert.equal(r.factor, 1);
  assert.equal(r.packs, 20);
  near(r.totals.ingredients, 2 / 3.785411784 * 15.14 + 0.1);
  near(r.totals.packaging, 20 * 1.5);
  near(r.totals.energy, 1.6);
  near(r.totals.labor, 15);
  near(r.totals.perPack, r.totals.total / 20);
  near(r.totals.suggestedPrice, r.totals.perPack * 2);
  near(r.totals.revenue, 200);
  assert.deepEqual(r.warnings, []);
});

test('scaling by output, packs, factor and ingredient on hand', () => {
  near(run(sauce, { mode: 'output', qty: 6, unit: 'L' }).factor, 2);
  near(run(sauce, { mode: 'output', qty: 1500, unit: 'g' }).factor, 0.5); // via density 1
  const byPacks = run(sauce, { mode: 'packs', packs: 50 });
  near(byPacks.factor, 2.5);
  assert.equal(byPacks.packs, 50);
  near(run(sauce, { mode: 'factor', factor: 3 }).output.qty, 9);
  near(run(sauce, { mode: 'ingredient', line: 0, qty: 1, unit: 'gal' }).factor, 3.785411784 / 2);
});

test('fixed steps stay the same, linear steps grow with the batch', () => {
  const r = run(sauce, { mode: 'factor', factor: 2 });
  near(r.steps[0].hours, 1);
  near(r.steps[0].energy[0].qty, 2);
  near(r.steps[1].laborHours, 1);
  near(r.lines[0].qty, 4);
  assert.equal(r.packs, 40);
  near(r.lines[2].qty, 40);
});

test('load based steps round up to whole loads', () => {
  const jerky = {
    yield_qty: 2, yield_unit: 'kg',
    lines: [{ ingredient_id: 1, qty: 5, unit: 'kg' }],
    steps: [{ label: 'Smoke', equipment_id: 1, hours: 3, scaling: 'loads', load_capacity: 2.5, load_unit: 'kg',
      energy: [{ energy_id: 2, qty: 1.5, per: 'hour' }, { energy_id: 1, qty: 0.5, per: 'run' }], labor_hours: 0.5 }],
  };
  const one = run(jerky);
  assert.equal(one.steps[0].runs, 1);
  const r = run(jerky, { mode: 'output', qty: 6, unit: 'kg' });
  assert.equal(r.steps[0].runs, 3);
  near(r.steps[0].hours, 9);
  near(r.energyBySource.find(e => e.energy_id === 2).qty, 13.5);
  near(r.energyBySource.find(e => e.energy_id === 1).qty, 1.5);
  near(r.totals.equipment, 9 * 1.5);
  near(r.totals.labor, 1.5 * 10);
  near(r.totals.perKg, r.totals.total / 6);
  // 6 kg is exactly 2.4 loads' worth plus some: 6 / 2.5 = 2.4 -> 3 loads; exactly 5 kg is 2 loads
  assert.equal(run(jerky, { mode: 'output', qty: 5, unit: 'kg' }).steps[0].runs, 2);
});

test('problems are reported, not thrown', () => {
  const r = run({ yield_qty: 1, yield_unit: 'kg', lines: [{ ingredient_id: 1, qty: 1, unit: 'L' }, { ingredient_id: 99, qty: 1, unit: 'g' }],
    steps: [{ scaling: 'loads', hours: 1 }] }, { mode: 'output', qty: 1, unit: 'L' });
  assert.equal(r.factor, 1);
  assert.ok(r.warnings.length >= 3);
  assert.equal(r.lines[0].cost, 0);
  assert.equal(r.lines[1].name, '(missing ingredient)');
});

test('percent of mix covers batch ingredients by weight', () => {
  const r = run({ yield_qty: 1, yield_unit: 'kg', lines: [{ ingredient_id: 1, qty: 975, unit: 'g' }, { ingredient_id: 2, qty: 25, unit: 'g' }] });
  near(r.lines[1].pct, 2.5);
});
