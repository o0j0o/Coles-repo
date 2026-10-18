'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/js/calc.js');

test('parseLength understands feet and inches', () => {
  assert.equal(C.parseLength('42'), 42);
  assert.equal(C.parseLength('42.5'), 42.5);
  assert.equal(C.parseLength("12' 6\""), 12.5);
  assert.equal(C.parseLength("12'6"), 12.5);
  assert.equal(C.parseLength('12 6'), 12.5);
  assert.equal(C.parseLength('12ft 6in'), 12.5);
  assert.equal(C.parseLength('18"'), 1.5);
  assert.ok(Number.isNaN(C.parseLength('abc')));
});

test('single straight run', () => {
  const g = C.computeGeometry({ runs: [{ length: 80 }], spacing: 8, height: 6 });
  assert.equal(g.sections, 10);
  assert.deepEqual(g.posts, { total: 11, line: 9, corner: 0, end: 2, gate: 0, terminal: 2 });
  assert.equal(g.sqft, 480);
});

test('partial section rounds up', () => {
  const g = C.computeGeometry({ runs: [{ length: 81 }], spacing: 8 });
  assert.equal(g.sections, 11);
  assert.equal(g.posts.total, 12);
});

test('two runs joined at a corner share a post', () => {
  const g = C.computeGeometry({ runs: [{ length: 40 }, { length: 40, joinPrev: true }], spacing: 8 });
  assert.equal(g.sections, 10);
  assert.deepEqual(g.posts, { total: 11, line: 8, corner: 1, end: 2, gate: 0, terminal: 3 });
});

test('closed rectangle has only corner posts as terminals', () => {
  const runs = [{ length: 40 }, { length: 24, joinPrev: true }, { length: 40, joinPrev: true }, { length: 24, joinPrev: true, closes: true }];
  const g = C.computeGeometry({ runs, spacing: 8 });
  assert.equal(g.sections, 16);
  assert.equal(g.posts.total, 16);
  assert.equal(g.posts.corner, 4);
  assert.equal(g.posts.end, 0);
  assert.equal(g.posts.line, 12);
});

test('gate splits a run and adds gate posts', () => {
  const g = C.computeGeometry({ runs: [{ length: 84 }], gates: [{ width: 4, run: 0 }], spacing: 8 });
  assert.equal(g.fenceLength, 80);
  assert.equal(g.gateCount, 1);
  assert.equal(g.posts.gate, 2);
  assert.equal(g.posts.end, 2);
  // 80ft net = 10 sections, +1 for the split
  assert.equal(g.sections, 11);
  assert.equal(g.posts.total, 13);
  assert.equal(g.posts.line, 9);
});

test('double gate counts two leaves', () => {
  const g = C.computeGeometry({ runs: [{ length: 60 }], gates: [{ width: 12, leaves: 2, run: 0 }], spacing: 8 });
  assert.equal(g.gateLeaves, 2);
  assert.equal(g.fenceLength, 48);
});

test('pricing: preferred supplier, then cheapest; quoted price beats markup', () => {
  const m = { prices: [{ cost: 10, supplier_id: 1 }, { cost: 8, supplier_id: 2 }] };
  assert.equal(C.materialCost(m), 8);
  m.prices[0].preferred = 1;
  assert.equal(C.materialCost(m), 10);
  assert.equal(C.materialPrice(m, { default_markup_pct: 50 }), 15);
  m.markup_pct = 20;
  assert.equal(C.materialPrice(m, { default_markup_pct: 50 }), 12);
  m.sell_price = 19.99;
  assert.equal(C.materialPrice(m, { default_markup_pct: 50 }), 19.99);
});

test('full estimate: packs, waste, swaps, overrides, labour and tax', () => {
  const materialsById = {
    1: { id: 1, name: 'Post', category: 'post', unit: 'each', pack_size: 1, waste_pct: 0, sell_price: 30, prices: [{ supplier_id: 1, cost: 20, preferred: 1 }] },
    2: { id: 2, name: 'Rail', category: 'rail', unit: 'each', pack_size: 1, waste_pct: 10, sell_price: 15, prices: [{ supplier_id: 1, cost: 10 }] },
    3: { id: 3, name: 'Screws', category: 'fastener', unit: 'box', pack_size: 100, waste_pct: 0, sell_price: 40, prices: [{ supplier_id: 1, cost: 25 }] },
    4: { id: 4, name: 'Big post', category: 'post', unit: 'each', pack_size: 1, waste_pct: 0, sell_price: 50, prices: [{ supplier_id: 1, cost: 35 }] },
    5: { id: 5, name: 'Gate', category: 'gate', unit: 'each', pack_size: 1, sell_price: 200, prices: [{ supplier_id: 1, cost: 120 }] },
  };
  const fenceType = {
    post_spacing: 8, default_height: 6, default_gate_material_id: 5,
    components: [
      { id: 11, category: 'post', material_id: 1, rule: 'per_post', qty: 1 },
      { id: 12, category: 'rail', material_id: 2, rule: 'per_section', qty: 3 },
      { id: 13, category: 'fastener', material_id: 3, rule: 'per_ft', qty: 15 },
    ],
  };
  const estimate = {
    runs: [{ length: 80 }], gates: [], post_spacing: 8, height: 6,
    labor_price_per_ft: 10, labor_cost_per_ft: 5, tax_rate: 10, discount: 0,
  };
  const r = C.computeEstimate({ estimate, fenceType, materialsById, settings: {} });
  const by = Object.fromEntries(r.lines.map(l => [l.component_id, l]));
  assert.equal(by[11].qty, 11);
  assert.equal(by[12].qty, 33); // 30 rails + 10% waste
  assert.equal(by[13].qty, 12); // 1200 screws / 100 per box
  assert.equal(r.totals.materials_price, 11 * 30 + 33 * 15 + 12 * 40);
  assert.equal(r.totals.labor_price, 800);
  assert.equal(r.totals.tax, Math.round((r.totals.subtotal) * 0.1 * 100) / 100);

  // swap posts for big posts, and force rail qty to 30
  estimate.overrides = { 11: { material_id: 4 }, 12: { qty: 30 } };
  const r2 = C.computeEstimate({ estimate, fenceType, materialsById, settings: {} });
  const by2 = Object.fromEntries(r2.lines.map(l => [l.component_id, l]));
  assert.equal(by2[11].name, 'Big post');
  assert.equal(by2[11].swapped, true);
  assert.equal(by2[12].qty, 30);
  assert.equal(by2[12].manual, true);

  // gate uses fence type default gate material
  estimate.gates = [{ width: 4, run: 0 }];
  const r3 = C.computeEstimate({ estimate, fenceType, materialsById, settings: {} });
  const gateLine = r3.lines.find(l => l.category === 'gate');
  assert.equal(gateLine.name, 'Gate');
  assert.equal(gateLine.qty, 1);

  // removed component disappears
  estimate.overrides = { 13: { removed: true } };
  const r4 = C.computeEstimate({ estimate, fenceType, materialsById, settings: {} });
  assert.ok(!r4.lines.some(l => l.component_id === 13));
});
