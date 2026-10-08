// Sanity checks for the scoring engine: `npm test`.
import assert from 'node:assert/strict';
import { buildRecord, scoreMatch, shotStats } from '../public/js/scoring.js';

const settings = { alliance: 'red', mode: '2v2', auto: true };
const start = 10;
const ev = (t, type, extra = {}) => ({ t: start + t, type, alliance: 'red', ...extra });

const raw = {
  events: [
    ev(5, 'launch', { element: 'pollen', count: 4, made: 4 }),
    ev(12, 'launch', { element: 'pollen', count: 4, made: 4 }),
    ev(13, 'hive_tip'),                                  // AUTO tip
    ev(33, 'launch', { element: 'pollen', count: 2, made: 2 }),  // transition: not counted
    ev(37, 'hive_tip'),                                  // completes in transition → AUTO
    ev(60, 'launch', { element: 'nectar', count: 3, made: 2 }),
    ev(61, 'hive_tip'),                                  // TELEOP
    ev(157, 'launch', { element: 'pollen', count: 4, made: 4 }),
    ev(159, 'hive_tip'),                                 // within settle after buzzer → counts
    ev(165, 'launch', { element: 'pollen', count: 4, made: 4 }), // after buzzer: not counted
    ev(170, 'hive_tip'),                                 // too late
    { t: start + 80, type: 'hive_tip', alliance: 'blue' },
    { t: start + 90, type: 'foul', alliance: 'blue', severity: 'major' },
  ],
  autoEnd: { red: { left: 2, parked: 1 }, blue: { left: 1, parked: 0 } },
  matchEnd: {
    red: { cell: 3, garden: 2, parked: 2 },
    blue: { cell: 1, garden: 0, parked: 1 },
    flowers: [{ elements: 5, owner: 'red', bottom: 'red' }, { elements: 3, owner: 'blue', bottom: 'red' }],
  },
};

const rec = buildRecord(raw, settings, start);
const red = rec.alliances.red;
assert.equal(red.autoTips, 2, 'auto tips (incl. transition completion)');
assert.equal(red.teleopTips, 2, 'teleop tips incl. settle');
assert.equal(red.bottomNectar, 2);
assert.equal(red.flowerElements, 5);
assert.equal(rec.alliances.blue.flowerElements, 3);

const { us, them } = scoreMatch(rec);
// AUTO: leave 2×3 + park 1×5 + tips 2×20 = 51
assert.equal(us.auto, 51);
// TELEOP: tips 40 + cell 6 + flower 10 + bottom 10 + garden 2 + park 10 = 78
assert.equal(us.teleop, 78);
assert.equal(us.total, 129);
assert.equal(us.rp.swarm.earned, true, '6+5+10 = 21 ≥ 16');
assert.equal(us.rp.pollinator1.earned, true);
assert.equal(us.rp.pollinator2.earned, false);
assert.equal(us.rpTotal.result, 'win');

const st = shotStats(rec.shots, 'red');
assert.equal(st.launched, 4 + 4 + 3 + 4, 'transition and post-buzzer shots excluded');
assert.equal(st.made, 14);

// Fouls are applied only when entered (AI-flagged fouls are suggestions).
assert.equal(us.fouls, 0);
rec.alliances.blue.majorFouls = 1;
assert.equal(scoreMatch(rec).us.fouls, 20);

// No-AUTO: the clock starts at TELEOP and AUTO fields are zeroed.
const rec2 = buildRecord(raw, { ...settings, auto: false }, start);
const s2 = scoreMatch(rec2).us;
assert.equal(s2.auto, 0);
assert.equal(rec2.alliances.red.autoLeave, 0);

// Solo: no opponent, no win/tie.
const rec3 = buildRecord(raw, { ...settings, mode: 'solo' }, start);
const s3 = scoreMatch(rec3);
assert.equal(s3.them, null);
assert.equal(s3.us.rpTotal.result, null);
assert.equal(rec3.alliances.red.autoLeave, 1, 'clamped to 1 robot');

console.log('scoring: all checks passed', { total: us.total, opp: them.total });
