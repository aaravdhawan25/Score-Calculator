// Orchestrates a full match analysis: sample frames inside the scoring window,
// send them in small batches, then read the end-of-AUTO and end-of-match state.

import { seek, grab } from './frames.js';
import { matchLength, MODES, TIMING } from './game.js';

const BATCH = 10;
const CONCURRENCY = 3;

function accessCode() {
  try { return localStorage.getItem('tipline.code') || ''; } catch { return ''; }
}

export async function api(task, frames, meta, { retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-access-code': accessCode() },
      body: JSON.stringify({ task, frames, meta }),
    });
    const data = await r.json().catch(() => ({ error: `Server returned ${r.status}` }));
    if (r.ok) return data.result;
    const retriable = r.status === 429 || r.status >= 500 && r.status !== 503;
    if (!retriable || attempt >= retries) {
      const err = new Error(data.error || `Request failed (${r.status})`);
      err.status = r.status;
      err.needsCode = data.needsCode;
      throw err;
    }
    await new Promise((res) => setTimeout(res, 1500 * 2 ** attempt));
  }
}

/** Run promises with a cap on how many are in flight. */
function limiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

/**
 * @param video   HTMLVideoElement with the match loaded
 * @param opts    { settings, start, fps, onStep(stepId, state, detail), signal }
 */
export async function analyzeMatch(video, { settings, start, fps, onStep, signal }) {
  const len = matchLength(settings.auto);
  const mode = MODES[settings.mode];
  const end = Math.min(video.duration, start + len + TIMING.settle);
  const meta = { alliance: settings.alliance, mode: mode.label, robots: mode.robotsPerAlliance, opponent: mode.opponent };
  const run = limiter(CONCURRENCY);
  const check = () => { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); };

  // 1. Sample the scoring window.
  const times = [];
  for (let t = start; t <= end + 1e-6; t += 1 / fps) times.push(+t.toFixed(2));
  const batches = [];
  for (let i = 0; i < times.length; i += BATCH) batches.push(times.slice(i, i + BATCH));

  onStep('frames', 'active', `0 / ${times.length} frames`);
  onStep('segments', 'active', `0 / ${batches.length} batches`);
  const events = [];
  const summaries = [];
  let done = 0;
  let extracted = 0;
  const pending = [];
  let prevFrame = null;

  for (const [bi, batch] of batches.entries()) {
    check();
    const frames = [];
    if (prevFrame) frames.push({ ...prevFrame, label: 'context' });
    for (const t of batch) {
      await seek(video, t);
      frames.push({ t, image: grab(video, 768, 0.7) });
      extracted++;
    }
    prevFrame = frames[frames.length - 1];
    onStep('frames', extracted === times.length ? 'done' : 'active', `${extracted} / ${times.length} frames`);
    const from = batch[0];
    const to = bi === batches.length - 1 ? end + 1 : batches[bi + 1][0] - 0.01;
    pending.push(run(async () => {
      check();
      const out = await api('segment', frames, { ...meta, from, to, contextFrame: bi > 0 });
      for (const ev of out?.events || []) {
        if (typeof ev?.t === 'number' && ev.t >= from - 0.5 && ev.t <= to + 0.5) events.push(ev);
      }
      if (out?.summary) summaries.push({ from, summary: out.summary });
      done++;
      onStep('segments', done === batches.length ? 'done' : 'active', `${done} / ${batches.length} batches`);
    }));
  }

  // 2. Checkpoints and robot profile (frames grabbed now, requests queued).
  const grabAt = async (ts, width = 1024) => {
    const out = [];
    for (const t of ts) {
      if (t < 0 || t > video.duration) continue;
      await seek(video, t);
      out.push({ t: +t.toFixed(2), image: grab(video, width, 0.75) });
    }
    return out;
  };

  let autoEnd = null;
  if (settings.auto) {
    onStep('autoEnd', 'active');
    const f = await grabAt([start + 26, start + 28, start + 29.5, start + 31, start + 33]);
    pending.push(run(async () => {
      autoEnd = await api('checkpoint', f, { ...meta, kind: 'auto_end', at: +(start + TIMING.auto).toFixed(1) });
      onStep('autoEnd', 'done');
    }));
  }

  onStep('matchEnd', 'active');
  const endFrames = await grabAt([start + len - 6, start + len - 3, start + len - 1, start + len, start + len + 2, start + len + 4, start + len + 6].filter((t) => t <= video.duration));
  let matchEnd = null;
  pending.push(run(async () => {
    matchEnd = await api('checkpoint', endFrames.length ? endFrames : await grabAt([video.duration - 0.2]), { ...meta, kind: 'match_end', at: +(start + len).toFixed(1) });
    onStep('matchEnd', 'done');
  }));

  onStep('robot', 'active');
  const profileTimes = Array.from({ length: 8 }, (_, i) => start + 2 + ((end - start - 4) * i) / 7);
  const profileFrames = await grabAt(profileTimes, 1024);
  let robot = null;
  pending.push(run(async () => {
    robot = await api('robot', profileFrames, meta);
    onStep('robot', 'done');
  }));

  const results = await Promise.allSettled(pending);
  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length === results.length) throw failures[0].reason;
  if (failures.some((f) => f.reason?.name === 'AbortError')) throw new DOMException('Cancelled', 'AbortError');

  return { events, autoEnd, matchEnd, robot, summaries: summaries.sort((a, b) => a.from - b.from), failed: failures.length };
}
