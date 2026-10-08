// BIOBUZZ presented by RTX — FIRST Tech Challenge 2026-27.
// Values transcribed from the Competition Manual (§10.1 timing, Table 10-2
// point values, Table 10-3 ranking-point thresholds, §10.6 fouls).
// Check the latest Team Update before relying on any number at an event.

export const TIMING = {
  auto: 30,        // §10.1 AUTO
  transition: 8,   // no driving, no scoring actions
  teleop: 120,     // 2:00 TELEOP
  flowerWindow: 60, // G410: NECTAR may enter FLOWERS only in the last 60 s
  settle: 3,       // HIVE TIPS keep being assessed until elements come to rest
};

export const POINTS = {
  autoLeave: 3,
  autoPark: 5,
  autoTip: 20,
  teleopPark: 5,
  teleopTip: 20,
  cell: 2,          // POLLEN / NECTAR remaining in a CELL at the end
  flower: 2,        // each element in a FLOWER you own (top-most NECTAR is yours)
  bottomNectar: 5,  // your NECTAR is the lowest NECTAR in a FLOWER
  garden: 1,
  minorFoul: 5,     // credited to the opponent
  majorFoul: 20,
};

export const RP = {
  swarm: 16,        // LEAVE + PARK points
  pollinator1: 4,   // HIVE TIPS
  pollinator2: 7,
  win: 3,
  tie: 1,
};

export const LIMITS = {
  carry: 4,         // G415: controlling 5+ SCORING ELEMENTS is a violation
  pollenOnField: 40,
  nectarPerAlliance: 8,
  flowers: 4,
};

export const MODES = {
  solo: { label: 'Solo practice', robotsPerAlliance: 1, opponent: false },
  '1v1': { label: '1v1', robotsPerAlliance: 1, opponent: true },
  '2v2': { label: '2v2 match', robotsPerAlliance: 2, opponent: true },
};

/** Total scoring window length in seconds, from the first robot movement. */
export function matchLength(autoEnabled) {
  return autoEnabled ? TIMING.auto + TIMING.transition + TIMING.teleop : TIMING.teleop;
}

/**
 * Which period a moment belongs to, in seconds since the match started.
 * With AUTO disabled, t = 0 is the start of TELEOP.
 */
export function phaseAt(t, autoEnabled) {
  if (t < 0) return 'pre';
  if (autoEnabled) {
    if (t < TIMING.auto) return 'auto';
    if (t < TIMING.auto + TIMING.transition) return 'transition';
    if (t <= matchLength(true)) return 'teleop';
    return 'post';
  }
  return t <= TIMING.teleop ? 'teleop' : 'post';
}

/** The field clock as it would be displayed: counts down inside each period. */
export function clockAt(t, autoEnabled) {
  const phase = phaseAt(t, autoEnabled);
  let remaining = 0;
  if (phase === 'pre') remaining = autoEnabled ? TIMING.auto : TIMING.teleop;
  else if (phase === 'auto') remaining = TIMING.auto - t;
  else if (phase === 'transition') remaining = TIMING.auto + TIMING.transition - t;
  else if (phase === 'teleop') remaining = matchLength(autoEnabled) - t;
  return { phase, remaining: Math.max(0, remaining) };
}

export function fmtClock(sec) {
  const s = Math.max(0, Math.ceil(sec - 1e-6));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const PHASE_LABEL = {
  pre: 'Pre-match',
  auto: 'Autonomous',
  transition: 'Transition',
  teleop: 'Driver-controlled',
  post: 'After buzzer',
};
