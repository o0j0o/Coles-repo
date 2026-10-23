'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const reader = require('../lib/recipe-reader.js');

function fakeClient(reply, capture) {
  return { beta: { messages: { create: async req => { capture.req = req; return reply; } } } };
}
const catalog = {
  ingredients: [{ id: 3, name: 'Scotch bonnet peppers', category: 'pepper' }],
  equipment: [{ id: 7, name: 'Reach-in fridge', kind: 'fridge / freezer', always_on: 1 }],
};
const answer = {
  name: 'Smoked Scotch Bonnet Pepper Sauce', product: 'pepper sauce', description: '', yield_qty: 4, yield_unit: 'L',
  pack_name: 'bottle', pack_qty: 150, pack_unit: 'ml',
  ingredients: [
    { name: 'Scotch bonnets', qty: 1.5, unit: 'kg', note: 'smoked', category: 'pepper', per_pack: false, match_id: 3 },
    { name: 'Allspice', qty: 2, unit: 'tsp', note: '', category: 'spice', per_pack: false, match_id: 99 },
    { name: 'Lime juice', qty: -1, unit: 'furlong', note: 'to taste', category: 'liquid', per_pack: false, match_id: 0 },
    { name: '  ', qty: 1, unit: 'g', note: '', category: 'other', per_pack: false, match_id: 0 },
  ],
  steps: [{ label: 'Rest overnight', kind: 'fridge', hours: 0, days: 1, equipment_id: 7 }, { label: 'Smoke', kind: 'smoke', hours: 2, days: 0, equipment_id: 42 }],
  method: '1. Smoke the peppers.', notes: 'Yield estimated.',
};

test('sends pages, PDFs, text and the catalog with a schema and refusal fallback', async () => {
  const cap = {};
  reader._setClient(fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] }, cap));
  const r = await reader.readRecipe({
    files: [{ type: 'image/jpeg', data: Buffer.from('img') }, { type: 'application/pdf', data: Buffer.from('pdf') }],
    text: 'extra text',
  }, catalog);
  const req = cap.req;
  assert.equal(req.model, 'claude-opus-5-5');
  assert.equal(req.fallbacks, 'default');
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(req.output_config.format.type, 'json_schema');
  const content = req.messages[0].content;
  assert.equal(content[0].type, 'image');
  assert.equal(content[0].source.data, Buffer.from('img').toString('base64'));
  assert.equal(content[1].type, 'document');
  assert.equal(content[1].source.media_type, 'application/pdf');
  assert.match(content[2].text, /extra text/);
  assert.match(content[3].text, /3: Scotch bonnet peppers/);
  assert.match(content[3].text, /7: Reach-in fridge/);

  assert.equal(r.ingredients.length, 3, 'blank names dropped');
  assert.equal(r.ingredients[0].match_id, 3);
  assert.equal(r.ingredients[1].match_id, null, 'unknown ids are not trusted');
  assert.deepEqual([r.ingredients[2].qty, r.ingredients[2].unit], [0, 'g']);
  assert.equal(r.steps[0].equipment_id, 7);
  assert.equal(r.steps[1].equipment_id, null);
  assert.equal(r.pack_unit, 'ml');
  assert.equal(r.notes, 'Yield estimated.');
});

test('refusals and cut-off answers become readable errors', async () => {
  reader._setClient(fakeClient({ stop_reason: 'refusal', content: [] }, {}));
  await assert.rejects(reader.readRecipe({ files: [], text: 'x' }, catalog), /declined/);
  reader._setClient(fakeClient({ stop_reason: 'max_tokens', content: [] }, {}));
  await assert.rejects(reader.readRecipe({ files: [], text: 'x' }, catalog), /too long/);
});
