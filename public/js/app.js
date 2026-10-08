import { TIMING, POINTS, RP, MODES, matchLength, clockAt, fmtClock, PHASE_LABEL } from './game.js';
import { buildRecord, scoreMatch, shotStats, other } from './scoring.js';
import { detectStart, seek } from './frames.js';
import { analyzeMatch, api, visitorKey } from './analyzer.js';
import { SUBSYSTEMS, normaliseSubsystem, matchTips, PLANNER_DEFAULTS, project, sensitivity } from './strategy.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const store = {
  get(k, d) { try { const v = localStorage.getItem(`tipline.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`tipline.${k}`, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

const state = {
  settings: { alliance: 'red', mode: '2v2', auto: true },
  fps: 1,
  start: null,
  raw: null,          // AI observations
  edits: { red: {}, blue: {} },
  record: null,
  aiRecord: null,
  robot: null,
  coachAI: null,
  detected: new Map(), // subsystem id -> evidence
  selected: new Set(store.get('subsystems', [])),
  running: null,
  health: null,
};

const video = $('#video');

/* ───────────────────────── settings */

function readSettings() {
  state.settings.alliance = $('input[name=alliance]:checked').value;
  state.settings.mode = $('input[name=mode]:checked').value;
  state.settings.auto = $('input[name=auto]:checked').value === 'on';
  state.fps = Number($('input[name=fps]:checked').value);
  document.body.dataset.alliance = state.settings.alliance;
  store.set('settings', { ...state.settings, fps: state.fps });
}

function restoreSettings() {
  const s = store.get('settings', null);
  if (!s) return;
  const pick = (name, val) => { const el = $(`input[name=${name}][value="${val}"]`); if (el) el.checked = true; };
  pick('alliance', s.alliance);
  pick('mode', s.mode);
  pick('auto', s.auto === false ? 'off' : 'on');
  pick('fps', s.fps || 1);
}

function updateSetupNotes() {
  const { mode, auto, alliance } = state.settings;
  const notes = {
    solo: `Scores only the ${alliance} alliance. Use this for practice runs with one robot.`,
    '1v1': `One robot per alliance. Both alliances are scored; SWARM needs ${RP.swarm} LEAVE+PARK points, more than one robot can earn (${(auto ? POINTS.autoLeave + POINTS.autoPark : 0) + POINTS.teleopPark}).`,
    '2v2': 'Two robots per alliance, full ranking-point rules, fouls credited to the other alliance.',
  };
  $('#modeNote').textContent = notes[mode];
  $('#autoNote').textContent = auto
    ? `Window: 0:30 AUTO → 0:08 transition → 2:00 TELEOP (${matchLength(true)} s from the first movement).`
    : 'TELEOP only: the 2:00 clock starts when the robot first moves. AUTO points are not scored.';
  const len = matchLength(auto) + TIMING.settle;
  const frames = Math.ceil(len * state.fps);
  const calls = Math.ceil(frames / 10) + (auto ? 3 : 2) + 1;
  $('#fpsNote').textContent = `${state.fps} frame${state.fps > 1 ? 's' : ''} per second · ~${frames} frames in ${calls} requests. ${state.fps > 1 ? 'Catches fast volleys; slower.' : 'Good for most matches.'}`;
}

function renderWindow() {
  const list = $('#windowList');
  if (state.start == null) { list.innerHTML = ''; $('#startReadout').innerHTML = '—'; return; }
  const s = state.start;
  const rows = state.settings.auto
    ? [['AUTO', s, s + TIMING.auto], ['Transition', s + TIMING.auto, s + TIMING.auto + TIMING.transition], ['TELEOP', s + TIMING.auto + TIMING.transition, s + matchLength(true)]]
    : [['TELEOP', s, s + TIMING.teleop]];
  list.innerHTML = rows.map(([n, a, b]) => `<li><span>${n}</span><b>${fmtVideo(a)} → ${fmtVideo(b)}</b></li>`).join('')
    + `<li><span>Nothing scores after</span><b>${fmtVideo(s + matchLength(state.settings.auto))}</b></li>`;
  $('#startReadout').innerHTML = `${fmtVideo(s)}<small>in the video</small>`;
}

function fmtVideo(t) {
  if (!Number.isFinite(t)) return '—';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/* ───────────────────────── video, clock, timeline */

function loadFile(file) {
  if (!file || !file.type.startsWith('video/')) { setStatus('That file is not a video.', true); return; }
  if (video.src) URL.revokeObjectURL(video.src);
  video.src = URL.createObjectURL(file);
  video.load();
  state.start = null;
  state.raw = null;
  $('#dropzone').hidden = true;
  $('#player').hidden = false;
  setStatus(`Loading ${file.name}…`);
}

video.addEventListener('loadedmetadata', async () => {
  $('#setStartBtn').disabled = false;
  $('#detectBtn').disabled = false;
  $('#analyzeBtn').disabled = false;
  renderTimeline();
  updateClock();
  if (video.duration < 20) setStatus('This clip is very short — a full match is about 2:40.', true);
  await runDetect(true);
});

video.addEventListener('error', () => setStatus('Your browser cannot play this video. Try exporting it as MP4 (H.264).', true));

async function runDetect(initial = false) {
  if (state.running) return;
  const btn = $('#detectBtn');
  btn.disabled = true;
  setStatus('Looking for the moment robots start moving…');
  const keep = video.currentTime;
  try {
    const t = await detectStart(video, { onProgress: (p) => { btn.textContent = `Detecting ${Math.round(p * 100)}%`; } });
    state.start = t;
    await seek(video, t);
    setStatus(t > 0
      ? `Match start detected at ${fmtVideo(t)}. Scrub to check it, then press “Use current frame” if it's off.`
      : 'No clear start found — scrub to the first robot movement and press “Use current frame”.');
  } catch (e) {
    state.start = 0;
    if (!initial) setStatus(e.message, true);
    await seek(video, keep).catch(() => {});
  } finally {
    btn.textContent = 'Auto-detect';
    btn.disabled = false;
    renderWindow();
    renderTimeline();
    updateClock();
  }
}

function setStatus(msg, error = false) {
  const el = $('#status');
  el.textContent = msg;
  el.classList.toggle('error', error);
}

let lastClockT = 0;
function updateClock() {
  const t = video.currentTime || 0;
  const vt = $('#vtime');
  vt.textContent = `${fmtVideo(t)} / ${fmtVideo(video.duration || 0).replace(/\.\d$/, '')}`;
  const pct = video.duration ? (t / video.duration) * 100 : 0;
  $('#tlHead').style.left = `${pct}%`;
  $('#timeline').setAttribute('aria-valuenow', Math.round(pct));
  if (state.start == null) return;
  const mt = t - state.start;
  const { phase, remaining } = clockAt(mt, state.settings.auto);
  const clock = $('#clock');
  clock.dataset.phase = phase;
  $('#clockPhase').textContent = phase === 'teleop' && remaining <= TIMING.flowerWindow ? 'Endgame' : PHASE_LABEL[phase];
  $('#clockTime').textContent = phase === 'post' ? '0:00' : fmtClock(remaining);

  // Flash scoring moments as the playhead passes them.
  if (state.record && !video.paused && t > lastClockT && t - lastClockT < 1) {
    for (const tip of state.record.tips) {
      if (tip.t > lastClockT && tip.t <= t) flash(tip.counted ? `${cap(tip.alliance)} HIVE TIP  +20` : `TIP not counted`);
    }
    const end = state.start + matchLength(state.settings.auto);
    if (end > lastClockT && end <= t) flash('BUZZER — scoring closed');
  }
  lastClockT = t;
}

function flash(text) {
  const el = $('#flash');
  el.hidden = false;
  el.textContent = text;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
}

let raf = 0;
function tick() { updateClock(); raf = requestAnimationFrame(tick); }
video.addEventListener('play', () => { $('#playBtn').classList.add('playing'); $('#playBtn').setAttribute('aria-label', 'Pause'); cancelAnimationFrame(raf); tick(); });
video.addEventListener('pause', () => { $('#playBtn').classList.remove('playing'); $('#playBtn').setAttribute('aria-label', 'Play'); cancelAnimationFrame(raf); updateClock(); });
video.addEventListener('seeked', updateClock);
$('#playBtn').addEventListener('click', () => (video.paused ? video.play() : video.pause()));
$$('[data-step]').forEach((b) => b.addEventListener('click', () => { video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + Number(b.dataset.step))); }));
video.addEventListener('click', () => (video.paused ? video.play() : video.pause()));

function renderTimeline() {
  const d = video.duration;
  if (!d) return;
  const bands = $('#tlBands');
  const pct = (t) => `${(Math.max(0, Math.min(d, t)) / d) * 100}%`;
  const span = (a, b) => `left:${pct(a)};width:calc(${pct(b)} - ${pct(a)})`;
  if (state.start == null) { bands.innerHTML = ''; $('#tlLegend').innerHTML = ''; return; }
  const s = state.start;
  const end = s + matchLength(state.settings.auto);
  let html = '';
  if (state.settings.auto) {
    html += `<div class="tl-band auto" style="${span(s, s + TIMING.auto)}"></div>`;
    html += `<div class="tl-band transition" style="${span(s + TIMING.auto, s + TIMING.auto + TIMING.transition)}"></div>`;
  }
  const teleStart = state.settings.auto ? s + TIMING.auto + TIMING.transition : s;
  html += `<div class="tl-band teleop" style="${span(teleStart, end - TIMING.flowerWindow)}"></div>`;
  html += `<div class="tl-band endgame" style="${span(end - TIMING.flowerWindow, end)}"></div>`;
  html += `<div class="tl-start" style="left:${pct(s)}"></div>`;
  bands.innerHTML = html;

  const marks = $('#tlMarks');
  if (state.record) {
    const mine = state.settings.alliance;
    marks.innerHTML = state.record.shots.map((sh) => {
      const cls = `${sh.made > 0 ? 'made' : 'miss'}${sh.alliance !== mine ? ' opp' : ''}`;
      return `<div class="tl-mark ${cls}" style="left:${pct(sh.t)};${sh.alliance !== mine ? `background:${sh.made ? `var(--${sh.alliance})` : 'transparent'};box-shadow:inset 0 0 0 1.5px var(--${sh.alliance})` : ''}"></div>`;
    }).join('') + state.record.tips.filter((tp) => tp.counted).map((tp) => `<div class="tl-mark tip" style="left:${pct(tp.t)}"></div>`).join('');
  } else marks.innerHTML = '';

  $('#tlLegend').innerHTML = (state.settings.auto ? '<span><i style="background:color-mix(in srgb,var(--honey) 38%,transparent)"></i>AUTO</span><span><i style="background:repeating-linear-gradient(135deg,var(--line-2) 0 2px,transparent 2px 4px)"></i>Transition</span>' : '')
    + '<span><i style="background:color-mix(in srgb,var(--ink) 12%,transparent)"></i>TELEOP</span><span><i style="background:color-mix(in srgb,var(--ink) 20%,transparent)"></i>Last 60 s</span>'
    + (state.record ? '<span><i style="background:var(--honey-ink);width:3px"></i>HIVE TIP</span><span><i style="background:var(--al)"></i>Volley</span>' : '');
}

(function timelineScrub() {
  const tl = $('#timeline');
  const seekTo = (e) => {
    const r = tl.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    if (video.duration) video.currentTime = x * video.duration;
  };
  let dragging = false;
  tl.addEventListener('pointerdown', (e) => { dragging = true; tl.setPointerCapture(e.pointerId); seekTo(e); });
  tl.addEventListener('pointermove', (e) => { if (dragging) seekTo(e); });
  tl.addEventListener('pointerup', () => { dragging = false; });
  tl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') video.currentTime = Math.min(video.duration, video.currentTime + 1);
    if (e.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - 1);
  });
})();

/* ───────────────────────── analysis */

const STEPS = [
  ['frames', 'Extract frames from the scoring window'],
  ['segments', 'Track launches and HIVE TIPS'],
  ['autoEnd', 'Read LEAVE / PARK at end of AUTO'],
  ['matchEnd', 'Read CELLS, FLOWERS, GARDENS and PARK at the buzzer'],
  ['robot', 'Identify robot subsystems'],
  ['coach', 'Write the coaching plan'],
];

function renderProgress() {
  const ol = $('#progress');
  ol.hidden = false;
  ol.innerHTML = STEPS.filter(([id]) => id !== 'autoEnd' || state.settings.auto)
    .map(([id, label]) => `<li data-step="${id}"><span>${label}</span><span class="mono"></span></li>`).join('');
}

function onStep(id, status, detail = '') {
  const li = $(`#progress li[data-step="${id}"]`);
  if (!li) return;
  li.className = status;
  li.lastElementChild.textContent = detail;
}

async function ensureHealth() {
  if (state.health) return state.health;
  try {
    state.health = await (await fetch('/api/health')).json();
  } catch {
    state.health = { ai: false, offline: true };
  }
  return state.health;
}

function askCode() {
  return new Promise((resolve) => {
    const dlg = $('#codeDialog');
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', () => {
      if (dlg.returnValue === 'ok') { try { localStorage.setItem('tipline.code', $('#codeInput').value.trim()); } catch { /* ignore */ } resolve(true); } else resolve(false);
    }, { once: true });
  });
}

function askKey() {
  return new Promise((resolve) => {
    const dlg = $('#keyDialog');
    dlg.returnValue = '';
    $('#keyInput').value = '';
    dlg.showModal();
    dlg.addEventListener('close', () => {
      const k = $('#keyInput').value.trim();
      if (dlg.returnValue === 'ok' && k) {
        try { localStorage.setItem('tipline.okey', k); } catch { /* ignore */ }
        renderKeyLine();
        resolve(true);
      } else resolve(false);
    }, { once: true });
  });
}

function forgetKey() {
  try { localStorage.removeItem('tipline.okey'); } catch { /* ignore */ }
  renderKeyLine();
}

/** One line under the button saying which OpenAI key analysis will use. */
function renderKeyLine() {
  const h = state.health;
  const el = $('#keyLine');
  if (!h || h.offline || h.mock || (h.ai && !h.visitorKey)) { el.hidden = true; return; }
  el.hidden = false;
  const k = visitorKey();
  el.innerHTML = k
    ? `OpenAI key: <span class="mono">sk-…${esc(k.slice(-4))}</span> (saved in this browser) <button type="button" class="linkbtn" data-key="change">Change</button><button type="button" class="linkbtn" data-key="remove">Remove</button>`
    : 'No OpenAI key on this site yet. <button type="button" class="linkbtn" data-key="change">Add your key</button>';
}

$('#keyLine').addEventListener('click', (e) => {
  const b = e.target.closest('[data-key]');
  if (!b) return;
  if (b.dataset.key === 'remove') forgetKey(); else askKey();
});

async function runAnalysis() {
  if (state.running) { state.running.abort(); return; }
  if (state.start == null) state.start = 0;
  readSettings();
  const health = await ensureHealth();
  if (health.offline) {
    setStatus('The analysis server is unreachable. If you opened the HTML file directly, run it with `npm run dev` or deploy to Vercel.', true);
    showManual();
    return;
  }
  if (!health.ai && !visitorKey() && !(await askKey())) {
    setStatus('Video analysis needs an OpenAI key. Add one with “Add your key”, or enter the score manually in the review panel.', true);
    showManual();
    return;
  }
  if (health.accessCode) {
    let has = '';
    try { has = localStorage.getItem('tipline.code') || ''; } catch { /* ignore */ }
    if (!has && !(await askCode())) return;
  }

  const ctrl = new AbortController();
  state.running = ctrl;
  const btn = $('#analyzeBtn');
  btn.textContent = 'Cancel analysis';
  btn.classList.add('running');
  $$('.setup input').forEach((i) => { i.disabled = true; });
  $('#setStartBtn').disabled = $('#detectBtn').disabled = true;
  video.pause();
  renderProgress();
  setStatus('Analyzing. Keep this tab open — this takes 1–3 minutes.');
  const keep = video.currentTime;

  try {
    const raw = await analyzeMatch(video, { settings: { ...state.settings }, start: state.start, fps: state.fps, onStep, signal: ctrl.signal });
    state.raw = raw;
    state.edits = { red: {}, blue: {} };
    state.robot = raw.robot;
    ingestRobot(raw.robot);
    rebuild();
    $('#results').hidden = false;
    setStatus(raw.failed ? `Done, but ${raw.failed} request${raw.failed > 1 ? 's' : ''} failed — some events may be missing. Check the review panel.` : 'Done. Review the counts below and correct anything the AI got wrong.', !!raw.failed);
    $('#results').scrollIntoView({ behavior: 'smooth' });

    onStep('coach', 'active');
    try {
      state.coachAI = await api('coach', [], { data: coachPayload() });
      onStep('coach', 'done');
    } catch {
      state.coachAI = null;
      onStep('coach', 'error', 'skipped');
    }
    renderCoaching();
  } catch (e) {
    if (e.name === 'AbortError') setStatus('Analysis cancelled.');
    else if (e.needsCode) {
      try { localStorage.removeItem('tipline.code'); } catch { /* ignore */ }
      setStatus('That access code was not accepted. Press “Score this match” to try again.', true);
    } else if (e.needsKey || (e.keyProblem && visitorKey())) {
      if (e.status === 401) forgetKey();
      setStatus(e.message, true);
      renderKeyLine();
    } else setStatus(e.message || 'Analysis failed.', true);
    $$('#progress li.active').forEach((li) => { li.className = 'error'; });
  } finally {
    state.running = null;
    btn.textContent = state.raw ? 'Re-score this match' : 'Score this match';
    btn.classList.remove('running');
    $$('.setup input').forEach((i) => { i.disabled = false; });
    $('#setStartBtn').disabled = $('#detectBtn').disabled = false;
    seek(video, keep).catch(() => {});
  }
}

function showManual() {
  if (!state.raw) state.raw = { events: [], autoEnd: null, matchEnd: null, summaries: [], manual: true };
  rebuild();
  $('#results').hidden = false;
  $('#resultsSub').textContent = 'Manual mode: enter what happened in the referee review panel and the score is computed from Table 10-2.';
}

/** Rebuild the scored record from AI observations + user edits. */
function rebuild() {
  if (!state.raw) return;
  readSettings();
  const base = buildRecord(state.raw, state.settings, state.start ?? 0);
  state.aiRecord = structuredClone(base);
  for (const al of ['red', 'blue']) Object.assign(base.alliances[al], state.edits[al]);
  state.record = base;
  renderResults();
  renderTimeline();
  renderCoaching();
  $('#plannerFromMatch').hidden = false;
}

/* ───────────────────────── results rendering */

function renderResults() {
  const rec = state.record;
  const { settings } = rec;
  const mine = settings.alliance;
  const theirs = other(mine);
  const { us, them } = scoreMatch(rec);
  const hasOpp = MODES[settings.mode].opponent;

  // Scoreboard
  const rpChip = (label, r) => `<span class="rp ${r.earned ? 'on' : ''} ${r.reachable ? '' : 'na'}" title="${esc(r.reachable ? `${r.value} / ${r.target}` : 'Not reachable with this many robots')}">${label} <span>${r.value}/${r.target}</span></span>`;
  const board = (s, al, isUs) => `
    <div class="sb ${al} ${isUs ? 'us' : 'them'}">
      <div class="sb-main">
        <div class="sb-label"><span class="tag">${cap(al)}</span>${isUs ? 'Your alliance' : 'Opponent'}${s.rpTotal.result ? `<span class="result-pill">${s.rpTotal.result.toUpperCase()}</span>` : ''}</div>
        <div class="sb-total" aria-label="${s.total} points">${s.total}</div>
        <div class="sb-split">
          ${settings.auto ? `<div><span>Auto</span><b>${s.auto}</b></div>` : ''}
          <div><span>TeleOp</span><b>${s.teleop}</b></div>
          ${hasOpp ? `<div><span>Fouls</span><b>${s.fouls}</b></div>` : ''}
          <div><span>Tips</span><b>${s.tips}</b></div>
        </div>
      </div>
      <div class="sb-rp">
        ${rpChip('SWARM', s.rp.swarm)}${rpChip('POLLINATOR 1', s.rp.pollinator1)}${rpChip('POLLINATOR 2', s.rp.pollinator2)}
        <span class="rp ${s.rpTotal.rp ? 'on' : ''}" style="margin-left:auto">RP ${s.rpTotal.rp}</span>
      </div>
    </div>`;
  $('#scoreboard').innerHTML = board(us, mine, true) + (them ? board(them, theirs, false) : '');
  $('#scoreboard').style.gridTemplateColumns = them ? '' : '1fr';

  // Shot tiles
  const st = shotStats(rec.shots, mine);
  const pct = st.accuracy == null ? '—' : `${Math.round(st.accuracy * 100)}%`;
  $('#shotTiles').innerHTML = [
    ['Launched', st.launched, `${st.volleys} volleys`],
    ['In CELL', st.made, `${st.pollen.made} pollen · ${st.nectar.made} nectar`],
    ['Missed', st.missed, ''],
    ['Accuracy', pct, settings.auto ? `Auto ${st.auto.launched ? Math.round((st.auto.made / st.auto.launched) * 100) + '%' : '—'}` : ''],
    ['HIVE TIPS', us.tips, settings.auto ? `${us.alliance.autoTips} auto · ${us.alliance.teleopTips} teleop` : ''],
    ['Pts / element', st.launched ? (us.total / st.launched).toFixed(1) : '—', 'total ÷ launched'],
  ].map(([k, v, s], i) => `<div class="tile ${i === 4 ? 'hl' : ''}"><span>${k}</span><b>${v}</b><small>${esc(s)}</small></div>`).join('');

  renderShotChart(rec, mine, hasOpp ? theirs : null);
  renderBreakdown(us, them, settings);
  renderReview(rec);
  renderExcluded(rec);
  renderPbp();
}

function renderBreakdown(us, them, settings) {
  const periods = [['auto', 'Autonomous'], ['teleop', 'Driver-controlled'], ['fouls', 'Fouls by opponent']];
  let html = `<table><thead><tr><th>Achievement</th><th class="num">Qty</th><th class="num">Each</th><th class="num">Pts</th>${them ? '<th class="num">Opp</th>' : ''}</tr></thead><tbody>`;
  for (const [p, label] of periods) {
    const lines = us.lines.filter((l) => l.period === p);
    const oppLines = them ? them.lines.filter((l) => l.period === p) : [];
    if (!lines.length && !oppLines.length) continue;
    if (p === 'auto' && !settings.auto) continue;
    html += `<tr class="period"><td colspan="${them ? 5 : 4}">${label}</td></tr>`;
    const keys = [...new Set([...lines, ...oppLines].map((l) => l.key))];
    for (const k of keys) {
      const l = lines.find((x) => x.key === k) || { ...oppLines.find((x) => x.key === k), qty: 0, pts: 0 };
      const o = oppLines.find((x) => x.key === k);
      html += `<tr class="${l.pts ? '' : 'zero'}"><td>${esc(l.label)}</td><td class="num">${l.qty}</td><td class="num">×${l.each}</td><td class="num">${l.pts}</td>${them ? `<td class="num muted">${o ? o.pts : 0}</td>` : ''}</tr>`;
    }
  }
  html += `<tr class="total"><td>Total</td><td></td><td></td><td class="num">${us.total}</td>${them ? `<td class="num">${them.total}</td>` : ''}</tr></tbody></table>`;
  $('#breakdown').innerHTML = html;
  $('#breakdownTag').textContent = `${cap(settings.alliance)} · ${MODES[settings.mode].label}${settings.auto ? '' : ' · no AUTO'}`;
}

const REVIEW_FIELDS = [
  ['Autonomous', [
    ['autoLeave', 'Robots that LEAVE', 'off the starting wall', 'auto'],
    ['autoPark', 'Robots PARKED', 'in LOADING ZONE at 0:30', 'auto'],
    ['autoTips', 'HIVE TIPS', 'completed before TELEOP', 'auto'],
  ]],
  ['Driver-controlled', [
    ['teleopTips', 'HIVE TIPS', ''],
    ['cell', 'Elements left in CELL', 'upward CELL at the end'],
    ['flowerElements', 'Elements in owned FLOWERS', 'your NECTAR on top'],
    ['bottomNectar', 'Bottom NECTAR bonuses', 'FLOWERS with your NECTAR lowest'],
    ['garden', 'Elements in GARDEN', ''],
    ['teleopPark', 'Robots PARKED', 'at the buzzer'],
  ]],
  ['Fouls committed', [
    ['minorFouls', 'MINOR FOULS', `+${POINTS.minorFoul} to the other alliance`, 'opp'],
    ['majorFouls', 'MAJOR FOULS', `+${POINTS.majorFoul} to the other alliance`, 'opp'],
  ]],
];

function renderReview(rec) {
  const { settings } = rec;
  const hasOpp = MODES[settings.mode].opponent;
  const cols = hasOpp ? [settings.alliance, other(settings.alliance)] : [settings.alliance];
  let html = `<div class="review-grid"><div class="review-row head" style="grid-template-columns:1fr ${cols.map(() => 'auto').join(' ')}"><span>Count</span>${cols.map((c) => `<span class="review-col-label ${c}">${cap(c)}</span>`).join('')}</div>`;
  for (const [section, fields] of REVIEW_FIELDS) {
    if (section === 'Autonomous' && !settings.auto) continue;
    if (section === 'Fouls committed' && !hasOpp) continue;
    html += `<div class="review-section">${section}</div>`;
    for (const [key, label, sub] of fields) {
      html += `<div class="review-row" style="grid-template-columns:1fr ${cols.map(() => 'auto').join(' ')}"><span>${label}${sub ? `<span class="sub">${sub}</span>` : ''}</span>`;
      for (const al of cols) {
        const v = rec.alliances[al][key];
        const ai = state.aiRecord?.alliances[al][key];
        const edited = state.edits[al][key] != null && state.edits[al][key] !== ai;
        html += `<span class="review-col-label"><span class="stepper ${edited ? 'edited' : ''}" title="${state.raw?.manual ? '' : `AI read: ${ai}`}">
          <button type="button" data-al="${al}" data-key="${key}" data-d="-1" aria-label="Decrease ${label} for ${al}">−</button>
          <input type="number" inputmode="numeric" min="0" value="${v}" data-al="${al}" data-key="${key}" aria-label="${label} for ${al}">
          <button type="button" data-al="${al}" data-key="${key}" data-d="1" aria-label="Increase ${label} for ${al}">+</button>
        </span></span>`;
      }
      html += '</div>';
    }
  }
  html += '</div>';
  if (Object.keys(state.edits.red).length + Object.keys(state.edits.blue).length) {
    html += '<button class="btn ghost small" type="button" id="resetEdits" style="margin-top:12px">Reset to AI counts</button>';
  }
  $('#review').innerHTML = html;
}

function applyEdit(al, key, value) {
  state.edits[al][key] = Math.max(0, Math.round(Number(value) || 0));
  rebuild();
  // Keep focus where the user was typing.
  const el = $(`#review input[data-al="${al}"][data-key="${key}"]`);
  if (el && document.activeElement?.tagName !== 'BUTTON') el.focus();
}

$('#review').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-d]');
  if (b) {
    const cur = state.record.alliances[b.dataset.al][b.dataset.key];
    applyEdit(b.dataset.al, b.dataset.key, cur + Number(b.dataset.d));
    $(`#review button[data-al="${b.dataset.al}"][data-key="${b.dataset.key}"][data-d="${b.dataset.d}"]`)?.focus();
  }
  if (e.target.id === 'resetEdits') { state.edits = { red: {}, blue: {} }; rebuild(); }
});
$('#review').addEventListener('change', (e) => {
  if (e.target.matches('input[data-key]')) applyEdit(e.target.dataset.al, e.target.dataset.key, e.target.value);
});

function renderExcluded(rec) {
  const items = [
    ...rec.shots.filter((s) => !s.counted).map((s) => ({ t: s.matchT, text: `${cap(s.alliance)} · ${s.count} ${s.element.toUpperCase()} launched — ${s.reason}` })),
    ...rec.tips.filter((t) => !t.counted || t.reason).map((t) => ({ t: t.matchT, text: `${cap(t.alliance)} HIVE TIP — ${t.counted ? `counted: ${t.reason}` : t.reason}` })),
    ...rec.flagged.map((f) => ({ t: f.matchT, text: `Possible ${f.kind.toUpperCase()} FOUL (${f.alliance}) — ${f.note || 'flagged by AI'}. Not applied; add it in the review panel if the referee called it.` })),
  ].sort((a, b) => a.t - b.t);
  $('#excluded').innerHTML = items.length
    ? `<ul class="excl-list">${items.map((i) => `<li><span class="mono">${matchClockLabel(i.t)}</span><span>${esc(i.text)}</span></li>`).join('')}</ul>`
    : '<p class="empty">Everything the AI saw happened inside the scoring window.</p>';
}

function matchClockLabel(mt) {
  const len = matchLength(state.settings.auto);
  if (mt < 0) return `−${fmtClock(-mt)}`;
  if (mt > len) return `+${fmtClock(mt - len)}`;
  return fmtClock(mt);
}

function renderPbp() {
  const s = state.raw?.summaries || [];
  $('#pbp').innerHTML = s.length
    ? `<ul class="pbp-list">${s.map((x) => `<li><span class="mono">${matchClockLabel(x.from - (state.start ?? 0))}</span><span>${esc(x.summary)}</span></li>`).join('')}</ul>`
    : '<p class="empty">No AI observations yet.</p>';
}

/* ───────────────────────── shot chart */

function renderShotChart(rec, mine, theirs) {
  const len = matchLength(rec.settings.auto);
  const W = 1000;
  const padL = 70, padR = 16, padT = 22, laneH = 74, gap = 12;
  const lanes = theirs ? [mine, theirs] : [mine];
  const H = padT + lanes.length * laneH + (lanes.length - 1) * gap + 28;
  const x = (t) => padL + (Math.max(-2, Math.min(len + TIMING.settle + 2, t)) / (len + TIMING.settle)) * (W - padL - padR);
  const r = 5.2;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Shots over match time">
    <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="transparent"/><line x1="0" y1="0" x2="0" y2="6" stroke="var(--line-2)" stroke-width="2"/></pattern></defs>`;

  const top = padT, bottom = H - 28;
  if (rec.settings.auto) {
    svg += `<rect class="band-auto" x="${x(0)}" y="${top}" width="${x(TIMING.auto) - x(0)}" height="${bottom - top}"/>`;
    svg += `<rect class="band-trans" x="${x(TIMING.auto)}" y="${top}" width="${x(TIMING.auto + TIMING.transition) - x(TIMING.auto)}" height="${bottom - top}"/>`;
  }
  svg += `<rect class="band-end" x="${x(len - TIMING.flowerWindow)}" y="${top}" width="${x(len) - x(len - TIMING.flowerWindow)}" height="${bottom - top}"/>`;
  svg += `<line class="axis" x1="${x(len)}" x2="${x(len)}" y1="${top - 8}" y2="${bottom}" stroke-dasharray="3 3"/><text x="${x(len)}" y="${top - 10}" text-anchor="middle">buzzer</text>`;
  if (rec.settings.auto) svg += `<text x="${x(TIMING.auto / 2)}" y="${top - 10}" text-anchor="middle">AUTO</text>`;
  svg += `<text x="${x(len - TIMING.flowerWindow / 2)}" y="${top - 10}" text-anchor="middle">last 60 s</text>`;

  // Ticks every 15 s of elapsed match time.
  for (let t = 0; t <= len; t += 15) {
    svg += `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${bottom}" y2="${bottom + 4}"/><text x="${x(t)}" y="${bottom + 17}" text-anchor="middle">${fmtClock(t)}</text>`;
  }

  lanes.forEach((al, li) => {
    const y0 = top + li * (laneH + gap);
    const base = y0 + laneH - 8;
    svg += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${base + 6}" y2="${base + 6}"/>`;
    svg += `<text class="lane-label" x="${padL - 10}" y="${y0 + laneH / 2 + 4}" text-anchor="end">${al === mine ? 'You' : 'Opp'} · ${cap(al)}</text>`;
    for (const tp of rec.tips.filter((t) => t.alliance === al)) {
      svg += `<g class="${tp.counted ? '' : 'void'}"><line class="tipline" x1="${x(tp.matchT)}" x2="${x(tp.matchT)}" y1="${y0 + 2}" y2="${base + 6}" ${tp.counted ? '' : 'stroke-dasharray="3 3"'}/><text class="tiplabel" x="${x(tp.matchT) + 4}" y="${y0 + 10}">TIP</text></g>`;
    }
    rec.shots.filter((s) => s.alliance === al).forEach((s, i) => {
      const cx = x(s.matchT);
      const n = Math.min(s.count, 6);
      let dots = '';
      for (let k = 0; k < n; k++) {
        const cy = base - k * (r * 2 + 2);
        const made = k < s.made;
        const fill = made ? `var(--${al})` : 'var(--panel)';
        dots += `<circle cx="${cx}" cy="${cy}" r="${s.element === 'nectar' ? r + 1.4 : r}" fill="${fill}" stroke="${made ? 'var(--panel)' : `var(--${al})`}" stroke-width="${made ? 2 : 1.6}"/>`;
      }
      svg += `<g class="vol ${s.counted ? '' : 'void'}" data-al="${al}" data-i="${i}">${dots}<rect class="hit" x="${cx - 9}" y="${y0}" width="18" height="${laneH}"/></g>`;
    });
  });
  svg += '</svg>';
  const el = $('#shotChart');
  el.innerHTML = svg;

  $('#chartLegend').innerHTML = `
    <span><svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="var(--${mine})"/></svg>In CELL</span>
    <span><svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="4.4" fill="none" stroke="var(--${mine})" stroke-width="1.6"/></svg>Missed</span>
    <span><svg viewBox="0 0 12 12"><rect x="5" y="0" width="2" height="12" fill="var(--honey-ink)"/></svg>HIVE TIP</span>
    <span>Larger dot = NECTAR · faded = not counted</span>`;

  const tt = $('#tooltip');
  el.querySelectorAll('g.vol').forEach((g) => {
    const s = rec.shots.filter((v) => v.alliance === g.dataset.al)[Number(g.dataset.i)];
    g.addEventListener('pointerenter', () => {
      tt.hidden = false;
      tt.innerHTML = `<b>${matchClockLabel(s.matchT)}</b> · ${PHASE_LABEL[s.phase]}<br>${s.count} ${s.element.toUpperCase()} launched, <b>${s.made}</b> in CELL${s.counted ? '' : `<br><i>${esc(s.reason)}</i>`}${s.note ? `<br><span style="opacity:.7">${esc(s.note)}</span>` : ''}`;
    });
    g.addEventListener('pointermove', (e) => { tt.style.left = `${Math.min(window.innerWidth - 270, e.clientX + 14)}px`; tt.style.top = `${e.clientY + 14}px`; });
    g.addEventListener('pointerleave', () => { tt.hidden = true; });
    g.addEventListener('click', () => { if (video.duration) { video.currentTime = Math.max(0, s.t - 2); $('#analyze').scrollIntoView({ behavior: 'smooth' }); } });
  });

  $('#shotTable').innerHTML = rec.shots.length
    ? `<table><thead><tr><th>Clock</th><th>Alliance</th><th>Element</th><th class="num">Launched</th><th class="num">In CELL</th><th>Counted</th></tr></thead><tbody>${rec.shots.map((s) => `<tr><td class="mono">${matchClockLabel(s.matchT)}</td><td>${cap(s.alliance)}</td><td>${s.element}</td><td class="num">${s.count}</td><td class="num">${s.made}</td><td>${s.counted ? 'Yes' : esc(s.reason)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="empty">No launches recorded.</p>';
}

/* ───────────────────────── coaching + subsystems */

function ingestRobot(robot) {
  state.detected.clear();
  for (const rb of robot?.robots || []) {
    for (const s of rb.subsystems || []) {
      const id = normaliseSubsystem(s);
      if (id && !state.detected.has(id)) state.detected.set(id, { evidence: s.evidence, performance: s.performance, name: s.name });
    }
  }
  if (state.detected.size) {
    state.selected = new Set([...state.detected.keys()]);
    store.set('subsystems', [...state.selected]);
  }
}

function coachPayload() {
  const { us, them } = scoreMatch(state.record);
  const st = shotStats(state.record.shots, state.settings.alliance);
  return {
    settings: state.settings,
    score: { total: us.total, auto: us.auto, teleop: us.teleop, lines: us.lines.filter((l) => l.pts).map((l) => `${l.period} ${l.label}: ${l.qty}×${l.each}`), rp: us.rp, opponent: them?.total ?? null },
    shots: { launched: st.launched, made: st.made, accuracy: st.accuracy, pollen: st.pollen, nectar: st.nectar, auto: st.auto, teleop: st.teleop },
    volleyTimes: state.record.shots.filter((s) => s.alliance === state.settings.alliance && s.counted).map((s) => +s.matchT.toFixed(1)),
    robot: state.robot,
  };
}

function renderCoaching() {
  const list = $('#tipList');
  const headline = $('#coachHeadline');
  if (!state.record) {
    list.innerHTML = '';
    headline.hidden = true;
  } else {
    const { us } = scoreMatch(state.record);
    const st = shotStats(state.record.shots, state.settings.alliance);
    const ballsPerTip = Number($('#p-ballsPerTip')?.value) || 8;
    const local = matchTips({ scored: us, stats: st, record: state.record, ballsPerTip }).map((t) => ({ ...t, src: '' }));
    const ai = (state.coachAI?.tips || []).filter((t) => t && t.title).map((t) => ({ ...t, gain: Math.max(0, Math.round(Number(t.gain) || 0)), src: 'AI coach' }));
    const seen = new Set();
    const all = [...local, ...ai].filter((t) => { const k = t.title.toLowerCase().slice(0, 24); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => b.gain - a.gain).slice(0, 9);
    headline.hidden = !state.coachAI?.headline;
    headline.textContent = state.coachAI?.headline || '';
    $('#coachSub').textContent = `Ranked by estimated points per match. Based on your ${cap(state.settings.alliance)} alliance scoring ${us.total} with ${st.launched} elements launched.`;
    list.innerHTML = all.map((t, i) => `
      <article class="tip ${i === 0 ? 'rank-1' : ''}">
        <div class="tip-top"><span class="tip-cat">${esc(t.category || 'strategy')}${t.src ? `<span class="src">· ${t.src}</span>` : ''}</span><span class="gain">+${t.gain} pts</span></div>
        <h4>${esc(t.title)}</h4>
        <p>${esc(t.detail)}</p>
      </article>`).join('');
  }
  renderSubsystems();
}

function renderSubsystems() {
  const groups = [...new Set(SUBSYSTEMS.map((s) => s.group))];
  $('#subsysChips').innerHTML = groups.map((g) => `<span class="chip-group">${g}</span>` + SUBSYSTEMS.filter((s) => s.group === g).map((s) =>
    `<button type="button" class="chip" data-id="${s.id}" aria-pressed="${state.selected.has(s.id)}">${s.name}${state.detected.has(s.id) ? '<span class="det">SEEN</span>' : ''}</button>`).join('')).join('');
  $('#subsysNote').textContent = state.detected.size ? `${state.detected.size} detected in your video · tap to adjust` : 'Tap what your robot has';

  const aiPlays = new Map();
  for (const w of state.coachAI?.weaponize || []) {
    const id = normaliseSubsystem({ name: w.subsystem });
    if (id && !aiPlays.has(id)) aiPlays.set(id, w);
  }
  const picked = SUBSYSTEMS.filter((s) => state.selected.has(s.id));
  $('#plays').innerHTML = picked.length ? picked.map((s) => {
    const det = state.detected.get(s.id);
    const ai = aiPlays.get(s.id);
    return `<article class="play">
      <span class="play-sub">${esc(s.name)}${det?.performance && det.performance !== 'unclear' ? ` · ${esc(det.performance)}` : ''}</span>
      <h4>${esc(ai?.play || s.play)}</h4>
      <p>${esc(ai?.how || s.how)}</p>
      <span class="edge">${esc(s.edge)}</span>
      ${det?.evidence ? `<span class="evidence">Seen: ${esc(det.evidence)}</span>` : ''}
    </article>`;
  }).join('') : '<p class="empty">Pick at least one subsystem to see how to use it.</p>';
}

$('#subsysChips').addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (!c) return;
  const id = c.dataset.id;
  state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
  store.set('subsystems', [...state.selected]);
  renderSubsystems();
});

/* ───────────────────────── planner */

const SOURCE_COLORS = {
  'AUTO LEAVE + PARK': 'var(--s1)',
  'AUTO TIPS': 'var(--s2)',
  'TELEOP TIPS': 'var(--s3)',
  'CELL leftovers': 'var(--s4)',
  FLOWERS: 'var(--s5)',
  'End PARK': 'var(--s6)',
};

function plannerValues() {
  const f = $('#plannerForm');
  const v = (n) => Number(f.elements[n].value);
  return {
    robots: Number($('input[name=p-robots]:checked').value),
    autoLeave: f.elements.autoLeave.checked,
    autoPark: f.elements.autoPark.checked,
    autoTips: v('autoTips'),
    cycle: v('cycle'),
    capacity: v('capacity'),
    accuracy: v('accuracy'),
    ballsPerTip: v('ballsPerTip'),
    flowerCaps: v('flowerCaps'),
    park: f.elements.park.checked,
    endDump: f.elements.endDump.checked,
  };
}

function renderPlanner() {
  const p = plannerValues();
  store.set('planner', p);
  $$('#plannerForm input[type=range]').forEach((r) => {
    const out = r.parentElement.querySelector('output');
    const unit = { cycle: ' s', accuracy: '%' }[r.name] || '';
    out.textContent = `${r.value}${unit}`;
    r.style.setProperty('--fill', `${((r.value - r.min) / (r.max - r.min)) * 100}%`);
  });
  const pr = project(p);
  $('#projTotal').textContent = pr.total;
  $('#projSplit').textContent = `${pr.autoTotal} auto · ${pr.teleopTotal} teleop · ${pr.tips} tips`;
  const parts = [
    ['AUTO LEAVE + PARK', pr.auto.leave + pr.auto.park],
    ['AUTO TIPS', pr.auto.tips],
    ['TELEOP TIPS', pr.teleop.tips],
    ['CELL leftovers', pr.teleop.cell],
    ['FLOWERS', pr.teleop.flowers],
    ['End PARK', pr.teleop.park],
  ];
  const total = Math.max(1, pr.total);
  $('#projBar').innerHTML = parts.filter(([, v]) => v > 0).map(([k, v]) => `<div style="flex-grow:${v};background:${SOURCE_COLORS[k]}" title="${k}: ${v}"></div>`).join('');
  $('#projBar').setAttribute('aria-label', parts.map(([k, v]) => `${k} ${v}`).join(', '));
  $('#projLegend').innerHTML = parts.map(([k, v]) => `<li><i style="background:${SOURCE_COLORS[k]}"></i>${k}<b>${v}</b></li>`).join('');
  const chip = (label, on, note) => `<span class="rp ${on ? 'on' : ''}" title="${esc(note)}">${label}</span>`;
  $('#projRP').innerHTML = chip('SWARM', pr.rp.swarm, `${pr.leavePark} / ${RP.swarm} LEAVE+PARK pts`) + chip('POLLINATOR 1', pr.rp.pollinator1, `${pr.tips} / ${RP.pollinator1} tips`) + chip('POLLINATOR 2', pr.rp.pollinator2, `${pr.tips} / ${RP.pollinator2} tips`);
  $('#projNote').textContent = `${pr.cycles} cycles per robot · ~${pr.made} elements in the CELL · ${Math.round((pr.teleop.tips / total) * 100)}% of points from TELEOP TIPS. Assumes ~8 s per FLOWER cap and 4 s to PARK.`;

  const sens = sensitivity(p);
  const max = Math.max(1, ...sens.map((s) => s.gain));
  $('#sens').innerHTML = sens.map((s) => `<li><span>${s.label}</span><span class="bar"><i style="width:${(Math.max(0, s.gain) / max) * 100}%"></i></span><b>+${s.gain}</b></li>`).join('');
}

function restorePlanner() {
  const p = { ...PLANNER_DEFAULTS, ...store.get('planner', {}) };
  const f = $('#plannerForm');
  for (const [k, v] of Object.entries(p)) {
    const el = f.elements[k];
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  }
  const r = $(`input[name=p-robots][value="${p.robots}"]`);
  if (r) r.checked = true;
}

$('#plannerForm').addEventListener('input', renderPlanner);
$('#plannerFromMatch').addEventListener('click', () => {
  if (!state.record) return;
  const f = $('#plannerForm');
  const mine = state.settings.alliance;
  const st = shotStats(state.record.shots, mine);
  const al = state.record.alliances[mine];
  const robots = MODES[state.settings.mode].robotsPerAlliance;
  $(`input[name=p-robots][value="${robots}"]`).checked = true;
  if (st.accuracy != null) f.elements.accuracy.value = Math.max(30, Math.round(st.accuracy * 20) * 5);
  const volleys = state.record.shots.filter((s) => s.alliance === mine && s.counted && s.phase === 'teleop');
  if (volleys.length >= 2) {
    const perRobot = (TIMING.teleop / Math.max(1, volleys.length)) * robots;
    f.elements.cycle.value = Math.max(4, Math.min(25, Math.round(perRobot * 2) / 2));
    const avg = volleys.reduce((s, v) => s + v.count, 0) / volleys.length;
    f.elements.capacity.value = Math.max(1, Math.min(4, Math.round(avg)));
  }
  f.elements.autoTips.value = Math.min(3, al.autoTips);
  f.elements.autoLeave.checked = al.autoLeave > 0;
  f.elements.autoPark.checked = al.autoPark > 0;
  f.elements.park.checked = al.teleopPark > 0;
  f.elements.flowerCaps.value = Math.min(4, al.bottomNectar);
  renderPlanner();
  $('#planner').scrollIntoView({ behavior: 'smooth' });
});

/* ───────────────────────── field map */

const ZONES = {
  hive: {
    title: 'HIVE', sub: 'Centre structure · one per alliance',
    body: 'Each alliance has a HIVE: two CELLS on one pivot, like a seesaw. Launch elements into your upward CELL; once it is heavy enough the HIVE TIPS, spilling the CELL and turning the empty one up.',
    pts: ['TIP 20 (AUTO or TELEOP)', 'Element left in CELL 2'],
    facts: ['A TIP completed before TELEOP starts counts as AUTO.', 'Each TIP lets your human player bring in one more NECTAR.', 'Forcing a TIP by contacting the HIVE frame is a foul.', 'Spilled elements must reach the floor before they are collected.', 'POLLINATOR RPs at 4 and 7 alliance TIPS.'],
  },
  flower: {
    title: 'FLOWER', sub: '4 on the perimeter walls',
    body: 'An opening about 21.5 in above the floor where elements stack. Whoever has the top-most NECTAR owns the FLOWER and scores every element inside it.',
    pts: ['Element in owned FLOWER 2', 'Bottom NECTAR 5'],
    facts: ['NECTAR may only enter a FLOWER in the last 60 seconds (G410).', 'POLLEN may go in any time — it pays whoever owns the FLOWER at the end.', 'Capping a full FLOWER with your NECTAR steals all of it.'],
  },
  garden: {
    title: 'GARDEN', sub: 'One per alliance, along a wall',
    body: 'Where POLLEN is staged at the start, and a low-value drop zone during the match.',
    pts: ['Element in GARDEN 1'],
    facts: ['Unprotected: either alliance may take elements back out.', 'Best used as a last-second dump when a CELL shot isn’t possible.'],
  },
  loading: {
    title: 'LOADING ZONE', sub: 'One per alliance, on the wall',
    body: 'Your human player feeds NECTAR into the field here, and it is where robots PARK.',
    pts: ['AUTO PARK 5', 'End PARK 5'],
    facts: ['One NECTAR is released per HIVE TIP until 1:00 remains, then all remaining NECTAR.', 'A robot must be at least partly inside to count as PARKED.', 'SWARM RP: 16 LEAVE + PARK points. Two robots that LEAVE and PARK in AUTO already have it.'],
  },
  start: {
    title: 'Starting position', sub: 'Against the perimeter wall',
    body: 'Robots start touching the wall with 4 pre-loaded POLLEN, inside an 18 in cube.',
    pts: ['AUTO LEAVE 3'],
    facts: ['LEAVE = no longer touching the perimeter wall at the end of AUTO.', 'A robot may control at most 4 elements at any time.'],
  },
};

function renderField() {
  const svg = $('#fieldSvg');
  const F = 20, S = 320, tile = S / 6;
  let g = `<rect class="tiles-bg" x="${F}" y="${F}" width="${S}" height="${S}"/>`;
  for (let i = 1; i < 6; i++) g += `<line class="tile-line" x1="${F + i * tile}" x2="${F + i * tile}" y1="${F}" y2="${F + S}"/><line class="tile-line" y1="${F + i * tile}" y2="${F + i * tile}" x1="${F}" x2="${F + S}"/>`;
  g += `<rect class="wall" x="${F}" y="${F}" width="${S}" height="${S}"/>`;
  const zone = (id, inner) => `<g class="zone" data-zone="${id}" tabindex="0" role="button" aria-label="${ZONES[id].title}">${inner}</g>`;
  // HIVE structure: blue half north, red half south; CELLS overhang each side.
  const hx = 180 - 44, hy = 180 - 55;
  g += zone('hive', `
    <rect class="shape" x="${hx}" y="${hy}" width="88" height="55" fill="var(--blue-wash)" stroke="var(--blue)"/>
    <rect class="shape" x="${hx}" y="180" width="88" height="55" fill="var(--red-wash)" stroke="var(--red)"/>
    <circle class="shape" cx="${hx - 2}" cy="${hy + 27}" r="11" fill="var(--panel)" stroke="var(--blue)"/><circle class="shape" cx="${hx + 90}" cy="${hy + 27}" r="11" fill="var(--blue)" stroke="var(--blue)"/>
    <circle class="shape" cx="${hx - 2}" cy="${207}" r="11" fill="var(--red)" stroke="var(--red)"/><circle class="shape" cx="${hx + 90}" cy="${207}" r="11" fill="var(--panel)" stroke="var(--red)"/>
    <text x="180" y="${hy + 31}" text-anchor="middle">BLUE HIVE</text><text x="180" y="211" text-anchor="middle">RED HIVE</text>`);
  const flowers = [[126.7, F], [F + S, 126.7], [233.3, F + S], [F, 233.3]];
  g += zone('flower', flowers.map(([cx, cy]) => `<circle class="shape" cx="${cx}" cy="${cy}" r="10" fill="var(--honey-wash)" stroke="var(--honey-ink)"/><circle cx="${cx}" cy="${cy}" r="3.5" fill="var(--honey-ink)"/>`).join('')
    + `<text x="126.7" y="${F + 24}" text-anchor="middle">FLOWER</text>`);
  g += zone('loading', `<rect class="shape" x="234" y="${F}" width="52" height="25" fill="var(--blue-wash)" stroke="var(--blue)"/><text x="260" y="${F + 16}" text-anchor="middle">LOAD</text>
    <rect class="shape" x="74" y="${F + S - 25}" width="52" height="25" fill="var(--red-wash)" stroke="var(--red)"/><text x="100" y="${F + S - 9}" text-anchor="middle">LOAD</text>`);
  g += zone('garden', `<rect class="shape" x="${F}" y="21" width="10" height="52" fill="var(--blue-wash)" stroke="var(--blue)"/><text x="${F + 15}" y="50">GARDEN</text>
    <rect class="shape" x="${F + S - 10}" y="287" width="10" height="52" fill="var(--red-wash)" stroke="var(--red)"/><text x="${F + S - 15}" y="316" text-anchor="end">GARDEN</text>`);
  g += zone('start', `<rect class="shape" x="${F}" y="140" width="22" height="22" fill="none" stroke="var(--ink-2)" stroke-dasharray="3 2"/><rect class="shape" x="${F + S - 22}" y="198" width="22" height="22" fill="none" stroke="var(--ink-2)" stroke-dasharray="3 2"/><text x="${F + 26}" y="155">START</text>`);
  g += `<text x="180" y="${F + S + 15}" text-anchor="middle" style="fill:var(--muted)">AUDIENCE</text>`;
  svg.innerHTML = g;
  svg.querySelectorAll('.zone').forEach((z) => {
    const go = () => showZone(z.dataset.zone);
    z.addEventListener('click', go);
    z.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  showZone('hive');
}

function showZone(id) {
  const z = ZONES[id];
  $$('#fieldSvg .zone').forEach((el) => el.classList.toggle('active', el.dataset.zone === id));
  $('#fieldInfo').innerHTML = `<span class="fi-sub">${z.sub}</span><h3>${z.title}</h3><p>${z.body}</p><div class="pts">${z.pts.map((p) => `<span>${p}</span>`).join('')}</div><ul>${z.facts.map((f) => `<li>${f}</li>`).join('')}</ul>`;
}

/* ───────────────────────── wiring */

const dz = $('#dropzone');
$('#file').addEventListener('change', (e) => loadFile(e.target.files[0]));
['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
$('#replaceBtn').addEventListener('click', () => $('#file').click());

$('#setStartBtn').addEventListener('click', () => {
  state.start = +video.currentTime.toFixed(2);
  renderWindow();
  renderTimeline();
  updateClock();
  if (state.raw) rebuild();
  setStatus(`Match start set to ${fmtVideo(state.start)}.`);
});
$('#detectBtn').addEventListener('click', () => runDetect());
$('#analyzeBtn').addEventListener('click', runAnalysis);

$$('.setup input[type=radio]').forEach((r) => r.addEventListener('change', () => {
  readSettings();
  updateSetupNotes();
  renderWindow();
  renderTimeline();
  updateClock();
  if (state.raw) rebuild();
}));

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, button, [role=slider]') || $('#player').hidden) return;
  if (e.code === 'Space') { e.preventDefault(); video.paused ? video.play() : video.pause(); }
});

restoreSettings();
readSettings();
updateSetupNotes();
renderWindow();
restorePlanner();
renderPlanner();
renderField();
renderCoaching();
ensureHealth().then((h) => {
  renderKeyLine();
  if (!h.ai) {
    const b = document.createElement('button');
    b.className = 'btn ghost small';
    b.type = 'button';
    b.textContent = 'Enter a score manually instead';
    b.style.marginTop = '8px';
    b.addEventListener('click', showManual);
    $('#status').after(b);
  }
});

