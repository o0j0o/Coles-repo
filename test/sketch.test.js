'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const reader = require('../lib/sketch-reader.js');

function fakeClient(reply, capture) {
  return { beta: { messages: { create: async req => { capture.req = req; return reply; } } } };
}

test('sends the image with a JSON schema and refusal fallback, and cleans the result', async () => {
  const cap = {};
  reader._setClient(fakeClient({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({
      runs: [
        { label: 'back', length: 60.5, corner_with_previous: true, closes_shape: false },
        { label: 'side', length: 40, corner_with_previous: true, closes_shape: false },
        { label: 'junk', length: 0, corner_with_previous: true, closes_shape: false },
      ],
      gates: [{ width: 4, run_index: 1, double: false }, { width: 12, run_index: 9, double: true }],
      notes: 'Side length estimated.',
    }) }],
  }, cap));
  const r = await reader.readSketch(Buffer.from('img'), 'image/jpeg', 'ft');
  assert.equal(cap.req.model, 'claude-opus-5-5');
  assert.equal(cap.req.fallbacks, 'default');
  assert.deepEqual(cap.req.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(cap.req.output_config.format.type, 'json_schema');
  assert.equal(cap.req.messages[0].content[0].source.data, Buffer.from('img').toString('base64'));
  assert.equal(r.runs.length, 2);
  assert.equal(r.runs[0].joinPrev, false); // first run never joins a previous one
  assert.equal(r.runs[1].joinPrev, true);
  assert.deepEqual(r.gates, [{ width: 4, run: 1, leaves: 1 }, { width: 12, run: -1, leaves: 2 }]);
  assert.equal(r.notes, 'Side length estimated.');
});

test('refusals become a readable error', async () => {
  reader._setClient(fakeClient({ stop_reason: 'refusal', content: [] }, {}));
  await assert.rejects(reader.readSketch(Buffer.from('x'), 'image/png', 'ft'), /declined/);
});
