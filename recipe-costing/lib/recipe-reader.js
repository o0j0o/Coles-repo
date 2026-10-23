'use strict';
// Reads a recipe from photos, scans, PDFs or pasted text using Claude, and
// matches its ingredients and equipment to the ones already in the app.
// Only active when ANTHROPIC_API_KEY is set.

const C = require('../public/js/costing.js');

const MODEL = process.env.RECIPE_MODEL || 'claude-opus-5-5';
const UNIT_NAMES = Object.keys(C.UNITS);
const STEP_KINDS = ['smoke', 'grill', 'dehydrate', 'cook', 'bake', 'fridge', 'freezer', 'grind', 'stuff', 'blend',
  'mix', 'slice', 'bottle', 'pack', 'other'];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'product', 'description', 'yield_qty', 'yield_unit', 'pack_name', 'pack_qty', 'pack_unit',
    'ingredients', 'steps', 'method', 'notes'],
  properties: {
    name: { type: 'string' },
    product: { type: 'string', enum: C.PRODUCTS },
    description: { type: 'string' },
    yield_qty: { type: 'number' },
    yield_unit: { type: 'string', enum: UNIT_NAMES },
    pack_name: { type: 'string' },
    pack_qty: { type: 'number' },
    pack_unit: { type: 'string', enum: UNIT_NAMES.concat(['']) },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'qty', 'unit', 'note', 'category', 'per_pack', 'match_id'],
        properties: {
          name: { type: 'string' },
          qty: { type: 'number' },
          unit: { type: 'string', enum: UNIT_NAMES },
          note: { type: 'string' },
          category: { type: 'string', enum: C.INGREDIENT_CATEGORIES },
          per_pack: { type: 'boolean' },
          match_id: { type: 'integer' },
        },
      },
    },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'kind', 'hours', 'days', 'equipment_id'],
        properties: {
          label: { type: 'string' },
          kind: { type: 'string', enum: STEP_KINDS },
          hours: { type: 'number' },
          days: { type: 'number' },
          equipment_id: { type: 'integer' },
        },
      },
    },
    method: { type: 'string' },
    notes: { type: 'string' },
  },
};

function enabled() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client = null;
function getClient() {
  if (!client) {
    const Anthropic = require('@anthropic-ai/sdk').default;
    client = new Anthropic();
  }
  return client;
}

function prompt(catalog) {
  const ings = catalog.ingredients.map(i => `${i.id}: ${i.name} (${i.category})`).join('\n') || '(none yet)';
  const eqs = catalog.equipment.map(e => `${e.id}: ${e.name} (${e.kind}${e.always_on ? ', fridge/freezer' : ''})`).join('\n') || '(none yet)';
  return `These are pages, photos or text of a recipe from a small Caribbean food business that makes pepper sauces, smoked pâtés, pastrami, jerky, meat sticks and pepper-infused rum. It may be handwritten, typed, a screenshot or a scan, and may span several images.

Extract the recipe as one batch, exactly as written. Do not invent ingredients or change amounts.

- name: the recipe's title, or a short descriptive name if there is none.
- product: the closest product type.
- yield_qty / yield_unit: how much one batch makes, if stated (e.g. "makes 4 L", "yields 24 bottles of 5 oz" -> 3.55 L or 24 x 5 fl oz expressed as 120 fl oz). If not stated, use 0 and say so in notes.
- pack_name / pack_qty / pack_unit: the retail pack if mentioned (e.g. bottle, 150, ml). Otherwise "", 0, "".
- ingredients: every ingredient and packaging item, in order.
  - qty and unit: convert to one of the allowed units. Keep the recipe's own unit when it is allowed (tbsp stays tbsp). Fractions become decimals (1 1/2 cups = 1.5 cup). For counted items such as "6 cloves garlic" or "12 peppers", use unit "each". For "to taste" or missing amounts, use qty 0 and explain in note.
  - note: preparation or detail written next to it (e.g. "seeded", "smoked", "2.5 g per kg meat"), else "".
  - category: best fit. Bottles, caps, labels, bags and pouches are "packaging"; curing salts such as Prague powder are "cure".
  - per_pack: true only for packaging used once per retail pack (one bottle, one label).
  - match_id: the id of the matching ingredient from the business's list below when it is clearly the same thing (allow for plurals, spelling and minor wording, e.g. "scotch bonnets" = "Scotch bonnet peppers"). 0 when there is no clear match. Never match different things (e.g. white vinegar is not apple cider vinegar).
- steps: the main production steps that use time or equipment, in order (e.g. smoke 4 hours, dehydrate 6 hours, cure in fridge 7 days, simmer 20 minutes, blend, bottle).
  - hours: time in hours for that step if stated, else 0. days: for curing, marinating, resting or storage in a fridge or freezer, the number of days (overnight = 1), else 0.
  - equipment_id: the id of the matching equipment from the list below, else 0. Use a fridge/freezer entry for curing, marinating or chilling steps.
- method: the full written instructions, cleaned up as numbered steps, keeping every temperature, time and food-safety detail.
- notes: a short plain-language list of anything you converted, estimated, could not read, or that should be double-checked (especially cure amounts and temperatures). "" if everything was clear.

The business's ingredients (id: name):
${ings}

The business's equipment (id: name):
${eqs}`;
}

/**
 * @param {{ files: { type: string, data: Buffer }[], text?: string }} input
 * @param {{ ingredients: object[], equipment: object[] }} catalog
 */
async function readRecipe(input, catalog) {
  const Anthropic = require('@anthropic-ai/sdk').default;
  const content = [];
  (input.files || []).forEach(f => {
    const data = f.data.toString('base64');
    if (f.type === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
    else content.push({ type: 'image', source: { type: 'base64', media_type: f.type, data } });
  });
  if (input.text) content.push({ type: 'text', text: 'Recipe text:\n\n' + input.text });
  content.push({ type: 'text', text: prompt(catalog) });

  let response;
  try {
    response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: SCHEMA },
      },
      messages: [{ role: 'user', content }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('The Anthropic API key is not valid.');
    if (err instanceof Anthropic.RateLimitError) throw new Error('The AI service is busy. Try again in a minute.');
    if (err instanceof Anthropic.APIConnectionError) throw new Error('Could not reach the AI service.');
    if (err instanceof Anthropic.APIError) throw new Error(`AI service error (${err.status}): ${err.message}`);
    throw err;
  }

  if (response.stop_reason === 'refusal') throw new Error('The AI declined to read this recipe.');
  if (response.stop_reason === 'max_tokens') throw new Error('The recipe was too long to read in one go. Try fewer pages at a time.');
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Could not understand the AI response.'); }
  return clean(data, catalog);
}

// Keep only values the app can use, and only ids that really exist.
function clean(d, catalog) {
  const ingIds = new Set(catalog.ingredients.map(i => i.id));
  const eqById = Object.fromEntries(catalog.equipment.map(e => [e.id, e]));
  const unit = (u, fallback) => (C.UNITS[u] ? u : fallback);
  const pos = n => (Number(n) > 0 ? Math.round(Number(n) * 1000) / 1000 : 0);
  const str = (s, max) => String(s || '').slice(0, max);
  return {
    name: str(d.name, 120) || 'Imported recipe',
    product: C.PRODUCTS.includes(d.product) ? d.product : 'other',
    description: str(d.description, 500),
    yield_qty: pos(d.yield_qty),
    yield_unit: unit(d.yield_unit, 'kg'),
    pack_name: str(d.pack_name, 40),
    pack_qty: pos(d.pack_qty),
    pack_unit: C.UNITS[d.pack_unit] ? d.pack_unit : '',
    ingredients: (d.ingredients || []).filter(i => i && String(i.name || '').trim()).map(i => ({
      name: str(i.name, 120),
      qty: pos(i.qty),
      unit: unit(i.unit, 'g'),
      note: str(i.note, 200),
      category: C.INGREDIENT_CATEGORIES.includes(i.category) ? i.category : 'other',
      per_pack: !!i.per_pack,
      match_id: ingIds.has(i.match_id) ? i.match_id : null,
    })),
    steps: (d.steps || []).map(s => {
      const eq = eqById[s.equipment_id] || null;
      return {
        label: str(s.label, 80) || 'Step',
        kind: STEP_KINDS.includes(s.kind) ? s.kind : 'other',
        hours: pos(s.hours),
        days: pos(s.days),
        equipment_id: eq ? eq.id : null,
      };
    }),
    method: str(d.method, 20000),
    notes: str(d.notes, 4000),
  };
}

// Lets tests supply a stand-in client.
function _setClient(c) { client = c; }

module.exports = { enabled, readRecipe, _setClient, MODEL };
