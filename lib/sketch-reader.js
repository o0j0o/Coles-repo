'use strict';
// Reads a hand-drawn or printed fence sketch (photo) and pulls out the fence
// runs and gates using Claude. Only active when ANTHROPIC_API_KEY is set.

const MODEL = process.env.SKETCH_MODEL || 'claude-opus-5-5';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['runs', 'gates', 'notes'],
  properties: {
    runs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'length', 'corner_with_previous', 'closes_shape'],
        properties: {
          label: { type: 'string' },
          length: { type: 'number' },
          corner_with_previous: { type: 'boolean' },
          closes_shape: { type: 'boolean' },
        },
      },
    },
    gates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['width', 'run_index', 'double'],
        properties: {
          width: { type: 'number' },
          run_index: { type: 'integer' },
          double: { type: 'boolean' },
        },
      },
    },
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

function prompt(unit) {
  const unitName = unit === 'm' ? 'metres' : 'feet';
  return `This image is a fence contractor's sketch or site plan of a fence job. It may be hand drawn, with lengths written along the lines.

Extract every straight run of fence, in order, walking along each fence line from one end to the other.
- length: the run's length in ${unitName}. Convert from whatever the sketch uses (12'6" = 12.5 ft; convert metres/feet if needed). If a run has no written dimension, estimate it from the drawing's proportions against the runs that do, and say so in notes.
- If a gate is drawn inside a run, the run length includes the gate opening.
- corner_with_previous: true when this run starts where the previous run ended (they share a corner post). The first run of each separate fence line is false.
- closes_shape: true only on the last run of a line that joins back to that line's starting point (a fully enclosed area).
- label: any name written on the sketch for that side (e.g. "back", "left side"), otherwise a short description like "north side" or "".

Gates: width in ${unitName}, run_index is the 0-based index of the run it sits in, double is true for a double/drive gate with two leaves. If a gate's width isn't written, use 4 ${unit === 'm' ? '(converted to metres)' : ''} for a walk gate or 12 for a drive gate and say so in notes.

Do not count things that are not fence (house walls, driveways, existing fence marked to stay).

notes: a short plain-language list of anything you estimated, could not read, or that the estimator should double-check. Empty string if everything was clearly written.`;
}

/**
 * @param {Buffer} image
 * @param {string} mediaType image/jpeg | image/png | image/webp
 * @param {string} unit 'ft' | 'm'
 */
async function readSketch(image, mediaType, unit) {
  const Anthropic = require('@anthropic-ai/sdk').default;
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
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image.toString('base64') } },
          { type: 'text', text: prompt(unit) },
        ],
      }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('The Anthropic API key is not valid.');
    if (err instanceof Anthropic.RateLimitError) throw new Error('The AI service is busy. Try again in a minute.');
    if (err instanceof Anthropic.APIConnectionError) throw new Error('Could not reach the AI service.');
    if (err instanceof Anthropic.APIError) throw new Error(`AI service error (${err.status}): ${err.message}`);
    throw err;
  }

  if (response.stop_reason === 'refusal') throw new Error('The AI declined to read this image.');
  if (response.stop_reason === 'max_tokens') throw new Error('The AI response was cut off. Try a clearer or smaller image.');
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Could not understand the AI response.'); }

  // Clean up anything out of range so the estimator never gets nonsense.
  const runs = (data.runs || [])
    .filter(r => Number(r.length) > 0)
    .map((r, i) => ({
      label: String(r.label || '').slice(0, 60),
      length: Math.round(Number(r.length) * 100) / 100,
      joinPrev: i > 0 && !!r.corner_with_previous,
      closes: !!r.closes_shape,
    }));
  const gates = (data.gates || [])
    .filter(g => Number(g.width) > 0)
    .map(g => ({
      width: Math.round(Number(g.width) * 100) / 100,
      run: Number.isInteger(g.run_index) && g.run_index >= 0 && g.run_index < runs.length ? g.run_index : -1,
      leaves: g.double ? 2 : 1,
    }));
  return { runs, gates, notes: String(data.notes || '') };
}

// Lets tests supply a stand-in client.
function _setClient(c) { client = c; }

module.exports = { enabled, readSketch, _setClient };
