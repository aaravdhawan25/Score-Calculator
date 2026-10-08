// Deterministic BIOBUZZ scoring. The AI only reports what it saw; every
// point on the page is computed here from the manual's tables, so a referee
// correction in the review panel re-scores instantly and exactly.

import { POINTS, RP, MODES, TIMING, phaseAt, matchLength } from './game.js';

export const EMPTY_ALLIANCE = Object.freeze({
  autoLeave: 0,
  autoPark: 0,
  autoTips: 0,
  teleopTips: 0,
  teleopPark: 0,
  cell: 0,
  flowerElements: 0,
  bottomNectar: 0,
  garden: 0,
  minorFouls: 0, // committed BY this alliance
  majorFouls: 0,
});

export const other = (a) => (a === 'red' ? 'blue' : 'red');

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

/** Keep an alliance record inside what the rules physically allow. */
export function sanitize(al, settings) {
  const robots = MODES[settings.mode].robotsPerAlliance;
  const out = { ...EMPTY_ALLIANCE, ...al };
  out.autoLeave = clampInt(out.autoLeave, 0, settings.auto ? robots : 0);
  out.autoPark = clampInt(out.autoPark, 0, settings.auto ? robots : 0);
  out.autoTips = clampInt(out.autoTips, 0, settings.auto ? 99 : 0);
  out.teleopTips = clampInt(out.teleopTips, 0, 99);
  out.teleopPark = clampInt(out.teleopPark, 0, robots);
  out.cell = clampInt(out.cell, 0, 40);
  out.flowerElements = clampInt(out.flowerElements, 0, 56);
  out.bottomNectar = clampInt(out.bottomNectar, 0, 4);
  out.garden = clampInt(out.garden, 0, 56);
  out.minorFouls = clampInt(out.minorFouls, 0, 99);
  out.majorFouls = clampInt(out.majorFouls, 0, 99);
  return out;
}

/**
 * Score one alliance. `opp` is the opposing alliance record (its fouls are
 * credited here); pass null for solo practice.
 */
export function scoreAlliance(al, opp, settings) {
  const a = sanitize(al, settings);
  const lines = [];
  const add = (period, key, label, qty, each) => {
    lines.push({ period, key, label, qty, each, pts: qty * each });
  };

  if (settings.auto) {
    add('auto', 'autoLeave', 'LEAVE', a.autoLeave, POINTS.autoLeave);
    add('auto', 'autoPark', 'PARK in LOADING ZONE', a.autoPark, POINTS.autoPark);
    add('auto', 'autoTips', 'HIVE TIPS', a.autoTips, POINTS.autoTip);
  }
  add('teleop', 'teleopTips', 'HIVE TIPS', a.teleopTips, POINTS.teleopTip);
  add('teleop', 'cell', 'Elements left in CELL', a.cell, POINTS.cell);
  add('teleop', 'flowerElements', 'Elements in owned FLOWERS', a.flowerElements, POINTS.flower);
  add('teleop', 'bottomNectar', 'Bottom NECTAR bonus', a.bottomNectar, POINTS.bottomNectar);
  add('teleop', 'garden', 'Elements in GARDEN', a.garden, POINTS.garden);
  add('teleop', 'teleopPark', 'PARK in LOADING ZONE', a.teleopPark, POINTS.teleopPark);

  let foulPts = 0;
  if (opp && MODES[settings.mode].opponent) {
    const o = sanitize(opp, settings);
    if (o.minorFouls) add('fouls', 'oppMinor', 'Opponent MINOR FOULS', o.minorFouls, POINTS.minorFoul);
    if (o.majorFouls) add('fouls', 'oppMajor', 'Opponent MAJOR FOULS', o.majorFouls, POINTS.majorFoul);
    foulPts = o.minorFouls * POINTS.minorFoul + o.majorFouls * POINTS.majorFoul;
  }

  const sum = (p) => lines.filter((l) => l.period === p).reduce((s, l) => s + l.pts, 0);
  const auto = sum('auto');
  const teleop = sum('teleop');
  const total = auto + teleop + foulPts;

  const tips = a.autoTips + a.teleopTips;
  const leavePark = a.autoLeave * POINTS.autoLeave + a.autoPark * POINTS.autoPark + a.teleopPark * POINTS.teleopPark;
  const robots = MODES[settings.mode].robotsPerAlliance;
  const maxLeavePark = robots * ((settings.auto ? POINTS.autoLeave + POINTS.autoPark : 0) + POINTS.teleopPark);

  const rp = {
    swarm: { earned: leavePark >= RP.swarm, value: leavePark, target: RP.swarm, reachable: maxLeavePark >= RP.swarm },
    pollinator1: { earned: tips >= RP.pollinator1, value: tips, target: RP.pollinator1, reachable: true },
    pollinator2: { earned: tips >= RP.pollinator2, value: tips, target: RP.pollinator2, reachable: true },
  };

  return { alliance: a, lines, auto, teleop, fouls: foulPts, total, tips, leavePark, rp };
}

/** Score the whole match, including WIN/TIE ranking points when there is an opponent. */
export function scoreMatch(record) {
  const { settings } = record;
  const mine = settings.alliance;
  const theirs = other(mine);
  const hasOpp = MODES[settings.mode].opponent;
  const us = scoreAlliance(record.alliances[mine], hasOpp ? record.alliances[theirs] : null, settings);
  const them = hasOpp ? scoreAlliance(record.alliances[theirs], record.alliances[mine], settings) : null;

  const rpTotal = (s, o) => {
    let n = (s.rp.swarm.earned ? 1 : 0) + (s.rp.pollinator1.earned ? 1 : 0) + (s.rp.pollinator2.earned ? 1 : 0);
    let result = null;
    if (o) {
      if (s.total > o.total) { n += RP.win; result = 'win'; }
      else if (s.total === o.total) { n += RP.tie; result = 'tie'; }
      else result = 'loss';
    }
    return { rp: n, result };
  };
  us.rpTotal = rpTotal(us, them);
  if (them) them.rpTotal = rpTotal(them, us);
  return { us, them };
}

/**
 * Turn raw AI observations into a scored record, applying the match clock.
 *  - Anything launched after the buzzer does not count.
 *  - Launches during the 8 s transition do not count (robots must be idle).
 *  - A TIP that completes before TELEOP begins counts as AUTO.
 *  - A TIP may finish up to TIMING.settle seconds after the buzzer if the
 *    elements that caused it were already in the air.
 */
export function buildRecord({ events = [], autoEnd = null, matchEnd = null }, settings, startOffset) {
  const len = matchLength(settings.auto);
  const blank = () => ({ ...EMPTY_ALLIANCE });
  const alliances = { red: blank(), blue: blank() };
  const shots = [];
  const tips = [];
  const flagged = [];
  const lastLaunch = { red: -Infinity, blue: -Infinity };

  const sorted = [...events].sort((a, b) => a.t - b.t);
  for (const ev of sorted) {
    const al = ev.alliance === 'blue' ? 'blue' : 'red';
    const t = ev.t - startOffset;
    const phase = phaseAt(t, settings.auto);
    const base = { t: ev.t, matchT: t, phase, alliance: al, confidence: ev.confidence ?? null, note: ev.note || '' };

    if (ev.type === 'launch') {
      const count = Math.max(1, Math.round(ev.count || 1));
      const made = ev.made == null ? (ev.result === 'in_cell' ? count : 0) : Math.min(count, Math.max(0, Math.round(ev.made)));
      let counted = true;
      let reason = '';
      if (phase === 'pre') { counted = false; reason = 'Before the match started'; }
      else if (phase === 'transition') { counted = false; reason = 'Launched during the 8 s transition'; }
      else if (phase === 'post') { counted = false; reason = 'Launched after the buzzer'; }
      if (counted) lastLaunch[al] = Math.max(lastLaunch[al], t);
      shots.push({ ...base, element: ev.element === 'nectar' ? 'nectar' : 'pollen', count, made, counted, reason });
    } else if (ev.type === 'hive_tip') {
      let counted = true;
      let reason = '';
      let period = phase === 'auto' || phase === 'transition' ? 'auto' : 'teleop';
      if (phase === 'pre') { counted = false; reason = 'Before the match started'; }
      if (phase === 'post') {
        const settled = t <= len + TIMING.settle && lastLaunch[al] >= len - TIMING.settle;
        if (settled) { period = 'teleop'; reason = 'Completed while elements came to rest'; }
        else { counted = false; reason = 'Tipped after the buzzer'; }
      }
      if (!settings.auto) period = 'teleop';
      tips.push({ ...base, period, counted, reason });
      if (counted) alliances[al][period === 'auto' ? 'autoTips' : 'teleopTips'] += 1;
    } else if (ev.type === 'foul') {
      flagged.push({ ...base, kind: ev.severity === 'major' ? 'major' : 'minor' });
    }
  }

  for (const al of ['red', 'blue']) {
    if (settings.auto && autoEnd && autoEnd[al]) {
      alliances[al].autoLeave = autoEnd[al].left ?? 0;
      alliances[al].autoPark = autoEnd[al].parked ?? 0;
    }
    if (matchEnd && matchEnd[al]) {
      const m = matchEnd[al];
      alliances[al].cell = m.cell ?? 0;
      alliances[al].garden = m.garden ?? 0;
      alliances[al].teleopPark = m.parked ?? 0;
    }
  }
  if (matchEnd && Array.isArray(matchEnd.flowers)) {
    for (const f of matchEnd.flowers) {
      if (f.owner === 'red' || f.owner === 'blue') alliances[f.owner].flowerElements += Math.max(0, f.elements || 0);
      if (f.bottom === 'red' || f.bottom === 'blue') alliances[f.bottom].bottomNectar += 1;
    }
  }

  for (const al of ['red', 'blue']) alliances[al] = sanitize(alliances[al], settings);
  return { settings: { ...settings }, alliances, shots, tips, flagged, flowers: matchEnd?.flowers || [] };
}

/** Shot totals for one alliance (only shots that count toward the score unless `all`). */
export function shotStats(shots, alliance, { all = false } = {}) {
  const list = shots.filter((s) => s.alliance === alliance && (all || s.counted));
  const by = (pred) => list.filter(pred).reduce((acc, s) => ({ launched: acc.launched + s.count, made: acc.made + s.made }), { launched: 0, made: 0 });
  const total = by(() => true);
  return {
    ...total,
    missed: total.launched - total.made,
    accuracy: total.launched ? total.made / total.launched : null,
    pollen: by((s) => s.element === 'pollen'),
    nectar: by((s) => s.element === 'nectar'),
    auto: by((s) => s.phase === 'auto'),
    teleop: by((s) => s.phase === 'teleop'),
    volleys: list.length,
  };
}
