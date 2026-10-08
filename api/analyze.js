// POST /api/analyze
// The browser extracts frames from the video locally and sends small batches
// here. This function forwards them to an OpenAI vision model with a strict
// JSON contract and returns the parsed result. The API key never leaves the
// server; set OPENAI_API_KEY in the Vercel project settings.

import { GAME_BRIEF } from './_rules.js';

const MAX_FRAMES = 16;
const MAX_IMAGE_CHARS = 450_000; // ~330 KB per base64 JPEG
const FALLBACK_MODEL = 'gpt-4.1';

const TASKS = {
  segment: {
    maxTokens: 2500,
    instructions: ({ meta }) => `
TASK: Watch this stretch of a BIOBUZZ match and log every scoring action.
The user's alliance is ${meta.alliance?.toUpperCase() || 'unknown'}. Match type: ${meta.mode || 'unknown'} (${meta.robots || '?'} robot(s) per alliance${meta.opponent ? ', opposing alliance present' : ', no opponent on the field'}).
Frames are in time order and labelled with video time in seconds. ${meta.contextFrame ? 'The FIRST frame is context only (it belongs to the previous batch): do not report events that happen at or before it.' : ''}
Only report events with time t in [${meta.from}, ${meta.to}].

Report:
- "launch": a robot shoots/throws POLLEN or NECTAR toward a HIVE CELL. One event per volley. "count" = balls launched, "made" = how many landed in the upward CELL (if you cannot tell, estimate and lower confidence).
- "hive_tip": a HIVE rotates to its other stable state. "alliance" = whose HIVE tipped.
- "flower": an element placed into a FLOWER (element + alliance).
- "garden": an element dropped into a GARDEN.
- "foul": an obvious rule violation (ramming the HIVE frame, pinning, more than 4 elements, NECTAR into a FLOWER too early). Include "severity": "minor" or "major".

Respond with JSON only:
{"events":[{"t":number,"type":"launch"|"hive_tip"|"flower"|"garden"|"foul","alliance":"red"|"blue","robot":"short description, e.g. red robot with turret","element":"pollen"|"nectar"|null,"count":integer,"made":integer,"severity":"minor"|"major"|null,"confidence":number,"note":"few words"}],
 "summary":"one sentence about what happened in this stretch"}`.trim(),
  },

  checkpoint: {
    maxTokens: 1500,
    instructions: ({ meta }) => meta.kind === 'auto_end' ? `
TASK: These frames show the end of the 30-second AUTONOMOUS period (video time ~${meta.at}s).
For each alliance, count robots that LEFT (no longer touching the perimeter wall they started against) and robots PARKED (at least partly inside their alliance's LOADING ZONE on the wall).
There are ${meta.robots} robot(s) per alliance${meta.opponent ? '' : ' and only the ' + (meta.alliance || '') + ' alliance is playing; report 0 for the other'}.
Respond with JSON only:
{"red":{"left":integer,"parked":integer},"blue":{"left":integer,"parked":integer},"confidence":number,"note":"short"}`.trim() : `
TASK: These frames show the final seconds of the match and the moment elements came to rest (buzzer at video time ~${meta.at}s).
Report the end state for each alliance:
- "cell": how many POLLEN+NECTAR are sitting in that alliance's upward-facing HIVE CELL.
- "garden": elements inside that alliance's GARDEN.
- "parked": robots at least partly inside that alliance's LOADING ZONE (max ${meta.robots}).
And for each of the 4 FLOWERS you can see: "elements" inside, "owner" (alliance of the top-most NECTAR, or null if no NECTAR) and "bottom" (alliance of the lowest NECTAR, or null).
${meta.opponent ? '' : 'Only the ' + (meta.alliance || '') + ' alliance is playing; report 0 for the other.'}
Respond with JSON only:
{"red":{"cell":integer,"garden":integer,"parked":integer},"blue":{"cell":integer,"garden":integer,"parked":integer},"flowers":[{"position":"short","elements":integer,"owner":"red"|"blue"|null,"bottom":"red"|"blue"|null}],"confidence":number,"note":"short"}`.trim(),
  },

  robot: {
    maxTokens: 2000,
    instructions: ({ meta }) => `
TASK: Identify the subsystems of the ${meta.alliance?.toUpperCase() || ''} alliance robot${meta.robots > 1 ? 's' : ''} in these frames (alliance colour is usually on the bumpers or flag).
Use these ids where they apply, and add others if you see them:
mecanum, tank, swerve, odometry_pods, vision_camera, wide_intake, roller_intake, claw, indexer, flywheel, dual_flywheel, adjustable_hood, turret, catapult, arm, elevator, flower_scorer.
For each subsystem: what you saw and how well it performed.
Respond with JSON only:
{"robots":[{"label":"short","subsystems":[{"id":"string","name":"Readable name","evidence":"what you saw","performance":"strong"|"ok"|"weak"|"unclear"}],"capacity_estimate":integer|null,"cycle_seconds_estimate":number|null,"launch_positions":"where it shoots from","notes":"short"}]}`.trim(),
  },

  coach: {
    maxTokens: 2500,
    text: true,
    instructions: ({ meta }) => `
TASK: You are the team's strategy coach. Using the scored breakdown, shot stats and detected subsystems below, write specific, numeric advice to raise their BIOBUZZ score.
Rules of thumb you may use: each HIVE TIP is 20 and counts toward POLLINATOR RPs at 4 and 7 alliance tips; elements left in the upward CELL at the buzzer are 2 each, so empty the robot into the CELL in the last seconds; NECTAR may only enter FLOWERS in the last 60 s; the alliance with the top-most NECTAR owns the FLOWER and scores 2 for every element in it (so capping a full FLOWER steals it), plus 5 for the bottom NECTAR; SWARM RP needs 16 LEAVE+PARK points (two robots that LEAVE and PARK in AUTO already have 16); each robot can hold at most 4 elements; the HIVE is a seesaw, so after each TIP the other CELL faces up.
Do not invent rules or point values.
DATA:
${JSON.stringify(meta.data).slice(0, 12000)}
Respond with JSON only:
{"headline":"one sentence","tips":[{"title":"short imperative","detail":"2-3 sentences, concrete","gain":integer (estimated points per match),"category":"auto"|"cycling"|"accuracy"|"endgame"|"flowers"|"defense"|"rp"}],
 "weaponize":[{"subsystem":"name","play":"short name for the tactic","how":"2-3 sentences"}]}`.trim(),
  },
};

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin fetches from some browsers omit it
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m = text && text.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Model did not return JSON');
  }
}

async function callOpenAI({ model, system, content, maxTokens }) {
  const reasoning = /^(gpt-5|o\d)/.test(model);
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content },
    ],
    response_format: { type: 'json_object' },
    max_completion_tokens: reasoning ? maxTokens + 6000 : maxTokens,
  };
  if (reasoning) body.reasoning_effort = 'low';
  else body.temperature = 0.1;

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data?.error?.message || `OpenAI error ${r.status}`);
    err.status = r.status;
    err.code = data?.error?.code;
    throw err;
  }
  const text = data.choices?.[0]?.message?.content || '';
  return { result: parseJsonLoose(text), usage: data.usage, model: data.model };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' });
  if (!sameOrigin(req)) return json(res, 403, { error: 'Cross-origin requests are not allowed' });

  if (process.env.ACCESS_CODE && req.headers['x-access-code'] !== process.env.ACCESS_CODE) {
    return json(res, 401, { error: 'Access code required', needsCode: true });
  }

  let payload = req.body;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
  }
  const { task, frames = [], meta = {} } = payload || {};
  const spec = TASKS[task];
  if (!spec) return json(res, 400, { error: 'Unknown task' });

  if (!spec.text) {
    if (!Array.isArray(frames) || frames.length === 0) return json(res, 400, { error: 'No frames' });
    if (frames.length > MAX_FRAMES) return json(res, 413, { error: `At most ${MAX_FRAMES} frames per request` });
    for (const f of frames) {
      if (typeof f?.image !== 'string' || !f.image.startsWith('data:image/jpeg;base64,') || f.image.length > MAX_IMAGE_CHARS) {
        return json(res, 400, { error: 'Frames must be JPEG data URLs under 330 KB' });
      }
    }
  }

  if (process.env.MOCK_AI === '1') {
    const { mockResponse } = await import('../scripts/mock.mjs');
    return json(res, 200, { result: mockResponse(task, frames, meta), model: 'mock' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return json(res, 503, { error: 'OPENAI_API_KEY is not set on the server. Add it in Vercel → Settings → Environment Variables and redeploy.' });
  }

  const content = [{ type: 'text', text: spec.instructions({ meta }) }];
  for (const f of frames) {
    content.push({ type: 'text', text: `Frame at t=${Number(f.t).toFixed(1)}s${f.label ? ` (${f.label})` : ''}` });
    content.push({ type: 'image_url', image_url: { url: f.image, detail: f.detail === 'low' ? 'low' : 'high' } });
  }

  const preferred = process.env.OPENAI_MODEL || 'gpt-5';
  try {
    let out;
    try {
      out = await callOpenAI({ model: preferred, system: GAME_BRIEF, content, maxTokens: spec.maxTokens });
    } catch (e) {
      const missingModel = e.status === 404 || e.code === 'model_not_found' || (e.status === 400 && /model/i.test(e.message || ''));
      if (!missingModel || preferred === FALLBACK_MODEL) throw e;
      out = await callOpenAI({ model: FALLBACK_MODEL, system: GAME_BRIEF, content, maxTokens: spec.maxTokens });
    }
    return json(res, 200, out);
  } catch (e) {
    const status = e.status === 429 ? 429 : 502;
    return json(res, status, { error: e.status === 401 ? 'The server\'s OpenAI key was rejected.' : e.message || 'Analysis failed' });
  }
}
