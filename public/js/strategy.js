// Strategy knowledge: what each subsystem is good for in BIOBUZZ, tips derived
// from a scored match, and the projection model behind the planner.

import { POINTS, RP, TIMING, LIMITS, MODES } from './game.js';

export const SUBSYSTEMS = [
  {
    id: 'turret', name: 'Turret', group: 'Launcher',
    play: 'Flip and fire',
    how: 'The HIVE is a seesaw: every TIP swaps which CELL faces up. A turret re-aims at the new CELL without the chassis moving, so the next volley leaves while other robots are still repositioning. Pair it with shoot-on-the-move and your cycle becomes intake → turn turret → fire.',
    edge: 'Saves ~1–2 s per TIP on the re-aim alone.',
  },
  {
    id: 'flywheel', name: 'Flywheel launcher', group: 'Launcher',
    play: 'Range lock',
    how: 'Consistent exit speed lets you pick one or two fixed launch spots you never miss from. Mark them with tape at practice, drive to the mark, fire all four. Keep the wheel spun up the whole match so there is never a spin-up wait.',
    edge: 'Turns accuracy into a habit instead of a skill.',
  },
  {
    id: 'dual_flywheel', name: 'Dual / backspin flywheel', group: 'Launcher',
    play: 'Flat-shot volleys',
    how: 'Two-wheel launchers fire flatter, faster shots that are less sensitive to distance. Use that to shoot from the far side of your launch area where defenders rarely sit, and to empty all four elements in under a second.',
    edge: 'Shorter time exposed to defence.',
  },
  {
    id: 'adjustable_hood', name: 'Adjustable hood', group: 'Launcher',
    play: 'Shoot from anywhere',
    how: 'A hood tied to distance (odometry or camera) means you can shoot from wherever you happen to intake. That cancels the drive to a launch spot entirely, which is usually the largest single chunk of a cycle.',
    edge: 'Can remove 2–4 s of driving per cycle.',
  },
  {
    id: 'catapult', name: 'Catapult / puncher', group: 'Launcher',
    play: 'One-shot dump',
    how: 'A catapult that throws a full load at once is ideal for the seesaw: drop 4 elements into the CELL in one motion, then turn away. Practise a fixed distance and keep the reload time shorter than your intake time.',
    edge: 'Whole load in one action.',
  },
  {
    id: 'wide_intake', name: 'Full-width intake', group: 'Intake',
    play: 'Spill sweeper',
    how: 'When a HIVE TIPS, its CELL spills a pile of elements onto the field. A full-width intake can drive straight through that pile and come out with four. Time your drive to arrive as the opponent HIVE tips; their spill is your next load.',
    edge: 'Fastest possible reload after a TIP.',
  },
  {
    id: 'roller_intake', name: 'Roller intake', group: 'Intake',
    play: 'Touch-it-own-it',
    how: 'Rollers grab on contact, so drive through elements instead of lining up to them. Practise collecting at speed along the GARDEN and the spill zones, and keep the rollers running in reverse as a quick way to drop into the GARDEN for 1 point each in the final seconds.',
    edge: 'Intake time approaches zero.',
  },
  {
    id: 'claw', name: 'Claw / grabber', group: 'Intake',
    play: 'Precision placement',
    how: 'A claw is slow for cycling but very accurate. Make it your FLOWER tool: in the last 60 s place NECTAR exactly on top of a FLOWER stack to take ownership of everything below it.',
    edge: 'Makes FLOWER captures reliable.',
  },
  {
    id: 'indexer', name: 'Indexer / magazine', group: 'Intake',
    play: 'Always fire four',
    how: 'The carry limit is 4. An indexer that holds exactly four and feeds them back-to-back means every trip to the HIVE is a full load. Never leave for the HIVE with fewer than four unless the clock says otherwise.',
    edge: 'Fewer trips per TIP.',
  },
  {
    id: 'mecanum', name: 'Mecanum drive', group: 'Drivetrain',
    play: 'Strafe-swap',
    how: 'Strafe sideways between the two launch zones as the HIVE flips, keeping the launcher pointed at the HIVE the whole time. It also lets you slide around a defender without turning your back to the target.',
    edge: 'No turn-around between CELLS.',
  },
  {
    id: 'tank', name: 'Tank / West Coast drive', group: 'Drivetrain',
    play: 'Hold your lane',
    how: 'Tank drive is hard to push. Use that to own your launch spot when an opponent tries to block it, and to win shoving matches near FLOWERS late in the match. Plan cycles as straight lines, not strafes.',
    edge: 'Pushing power and stability.',
  },
  {
    id: 'swerve', name: 'Swerve drive', group: 'Drivetrain',
    play: 'Drive one way, aim the other',
    how: 'Swerve lets you translate in any direction at full speed while facing the HIVE. Combine with a fixed launcher to shoot while moving across the field.',
    edge: 'Full speed in every direction.',
  },
  {
    id: 'odometry_pods', name: 'Odometry / localisation', group: 'Software',
    play: 'Auto that tips',
    how: 'Accurate localisation is what makes a multi-tip AUTO possible: shoot the 4 pre-loads, collect from the GARDEN, shoot again, then LEAVE and PARK. Two robots that LEAVE and PARK in AUTO already have the 16 points for the SWARM RP before TELEOP starts.',
    edge: 'AUTO points and SWARM RP.',
  },
  {
    id: 'vision_camera', name: 'Vision camera', group: 'Software',
    play: 'Read the HIVE',
    how: 'Use the camera to detect which CELL is facing up and aim automatically. In AUTO it can also confirm a TIP happened before you move on.',
    edge: 'Fewer wasted shots at the down CELL.',
  },
  {
    id: 'arm', name: 'Arm', group: 'Endgame',
    play: 'FLOWER cap',
    how: 'The FLOWER opening is about 21.5 in up. An arm that reaches it lets you drop NECTAR on top of an existing stack in the last 60 s, taking 2 points for every element inside plus the 5-point bottom bonus if yours is the first NECTAR in.',
    edge: '~15 points per FLOWER captured.',
  },
  {
    id: 'elevator', name: 'Elevator / lift', group: 'Endgame',
    play: 'Late steal',
    how: 'A lift can reach FLOWERS quickly and repeatably. Save one NECTAR for the final seconds to re-cap a FLOWER the opponent just took — whoever is top-most when the match ends owns it.',
    edge: 'Last word on FLOWER ownership.',
  },
  {
    id: 'flower_scorer', name: 'FLOWER mechanism', group: 'Endgame',
    play: 'Endgame route',
    how: 'Plan a fixed endgame route with 60 s left: one NECTAR in each FLOWER on your side, then PARK. Rehearse it to a stopwatch so you always know the exact moment to leave the HIVE.',
    edge: 'Repeatable endgame points.',
  },
];

export const SUBSYSTEM_BY_ID = Object.fromEntries(SUBSYSTEMS.map((s) => [s.id, s]));

/** Match a free-text subsystem from the AI to the catalogue where possible. */
export function normaliseSubsystem(s) {
  if (!s) return null;
  if (SUBSYSTEM_BY_ID[s.id]) return s.id;
  const text = `${s.id || ''} ${s.name || ''}`.toLowerCase();
  const pairs = [
    ['turret', 'turret'], ['hood', 'adjustable_hood'], ['catapult', 'catapult'], ['puncher', 'catapult'],
    ['dual', 'dual_flywheel'], ['flywheel', 'flywheel'], ['shooter', 'flywheel'], ['mecanum', 'mecanum'],
    ['swerve', 'swerve'], ['tank', 'tank'], ['west coast', 'tank'], ['odometry', 'odometry_pods'],
    ['camera', 'vision_camera'], ['vision', 'vision_camera'], ['limelight', 'vision_camera'],
    ['claw', 'claw'], ['grab', 'claw'], ['index', 'indexer'], ['magazine', 'indexer'], ['hopper', 'indexer'],
    ['roller', 'roller_intake'], ['wide', 'wide_intake'], ['intake', 'wide_intake'],
    ['elevator', 'elevator'], ['lift', 'elevator'], ['slide', 'elevator'], ['arm', 'arm'], ['flower', 'flower_scorer'],
  ];
  for (const [k, id] of pairs) if (text.includes(k)) return id;
  return null;
}

/** Points-per-element of feeding a CELL, given how many elements tip it. */
export const tipValuePerElement = (ballsPerTip) => POINTS.teleopTip / Math.max(1, ballsPerTip);

/**
 * Tips derived from what actually happened in the match.
 * Each tip carries an estimated point gain so the list can be ranked.
 */
export function matchTips({ scored, stats, record, ballsPerTip = 8 }) {
  const { settings } = record;
  const robots = MODES[settings.mode].robotsPerAlliance;
  const a = scored.alliance;
  const tips = [];
  const per = tipValuePerElement(ballsPerTip);

  if (stats.launched > 0 && stats.missed > 0) {
    tips.push({
      category: 'accuracy',
      title: `Convert the ${stats.missed} missed shot${stats.missed === 1 ? '' : 's'}`,
      detail: `${stats.made} of ${stats.launched} launched elements landed (${Math.round(stats.accuracy * 100)}%). At roughly ${ballsPerTip} elements per TIP, every miss costs about ${per.toFixed(1)} points. Shoot from one rehearsed spot and only fire full loads of ${LIMITS.carry}.`,
      gain: Math.round(stats.missed * per),
    });
  }

  const wasted = record.shots.filter((s) => s.alliance === settings.alliance && !s.counted && s.phase !== 'pre');
  if (wasted.length) {
    const n = wasted.reduce((s, x) => s + x.count, 0);
    tips.push({
      category: 'rules',
      title: `${n} element${n === 1 ? '' : 's'} launched outside the scoring window`,
      detail: `Shots during the 8-second transition or after the buzzer don't score. Watch the field clock: with 5 s left, the best move is to fire whatever is on board into the CELL — it scores ${POINTS.cell} each if it stays there.`,
      gain: Math.round(n * Math.max(per, POINTS.cell)),
    });
  }

  if (a.cell === 0) {
    tips.push({
      category: 'endgame',
      title: 'Finish with a loaded CELL',
      detail: `Elements still in your upward CELL at the end score ${POINTS.cell} each. If a TIP isn't possible in the final seconds, a last volley of ${LIMITS.carry} is still worth ${LIMITS.carry * POINTS.cell}.`,
      gain: LIMITS.carry * POINTS.cell,
    });
  }

  if (a.bottomNectar === 0) {
    tips.push({
      category: 'flowers',
      title: 'Cap a FLOWER in the last 60 seconds',
      detail: `NECTAR can enter FLOWERS once 1:00 remains. The first NECTAR in a FLOWER earns the ${POINTS.bottomNectar}-point bottom bonus, and owning it (top-most NECTAR) adds ${POINTS.flower} per element inside. A FLOWER with its 4 staged POLLEN plus your NECTAR is ${POINTS.bottomNectar + 5 * POINTS.flower} points.`,
      gain: POINTS.bottomNectar + 5 * POINTS.flower,
    });
  } else if (a.flowerElements === 0) {
    tips.push({
      category: 'flowers',
      title: 'Re-take the FLOWERS you started',
      detail: `You earned the bottom NECTAR bonus but don't own the FLOWER at the end. Ownership goes to the top-most NECTAR, so save one NECTAR to re-cap in the final 10 seconds.`,
      gain: 5 * POINTS.flower,
    });
  }

  if (a.teleopPark < robots) {
    const n = robots - a.teleopPark;
    tips.push({
      category: 'endgame',
      title: `PARK ${n === robots ? (robots > 1 ? 'both robots' : 'the robot') : 'the second robot'} in the LOADING ZONE`,
      detail: `Each robot partly inside the LOADING ZONE at the end is ${POINTS.teleopPark} points and counts toward the SWARM RP. Leave the HIVE with about 4 s to spare.`,
      gain: n * POINTS.teleopPark,
    });
  }

  if (settings.auto) {
    if (a.autoLeave < robots) {
      tips.push({
        category: 'auto',
        title: 'Never miss LEAVE',
        detail: `Just driving off the wall in AUTO is ${POINTS.autoLeave} points per robot. Even a "do nothing" AUTO should drive forward.`,
        gain: (robots - a.autoLeave) * POINTS.autoLeave,
      });
    }
    if (a.autoPark < robots) {
      tips.push({
        category: 'auto',
        title: 'End AUTO in the LOADING ZONE',
        detail: `An AUTO PARK is another ${POINTS.autoPark} per robot.${robots > 1 ? ` Two robots that LEAVE and PARK in AUTO have ${2 * (POINTS.autoLeave + POINTS.autoPark)} LEAVE+PARK points, enough for the SWARM RP before TELEOP starts.` : ''}`,
        gain: (robots - a.autoPark) * POINTS.autoPark,
      });
    }
    if (a.autoTips === 0) {
      tips.push({
        category: 'auto',
        title: 'Tip the HIVE in AUTO',
        detail: `Every robot starts with ${LIMITS.carry} POLLEN. Firing the pre-loads and one GARDEN load (${LIMITS.carry} more) in AUTO is enough to tip the HIVE on most fields for ${POINTS.autoTip} points.`,
        gain: POINTS.autoTip,
      });
    }
  } else {
    tips.push({
      category: 'auto',
      title: 'Add even a simple AUTO',
      detail: `With no AUTO you give up LEAVE (${POINTS.autoLeave}), PARK (${POINTS.autoPark}) and the chance at an AUTO TIP (${POINTS.autoTip}) per robot. A drive-off-and-park routine is a 1-hour project worth ${POINTS.autoLeave + POINTS.autoPark}.`,
      gain: POINTS.autoLeave + POINTS.autoPark,
    });
  }

  const tipsTotal = scored.tips;
  if (tipsTotal < RP.pollinator1 && tipsTotal >= RP.pollinator1 - 2) {
    tips.push({ category: 'rp', title: `${RP.pollinator1 - tipsTotal} more TIP${RP.pollinator1 - tipsTotal === 1 ? '' : 's'} for POLLINATOR 1`, detail: `The alliance needs ${RP.pollinator1} HIVE TIPS for a ranking point. Ranking points decide seeding; one RP is worth more than a few match points.`, gain: (RP.pollinator1 - tipsTotal) * POINTS.teleopTip });
  } else if (tipsTotal >= RP.pollinator1 && tipsTotal < RP.pollinator2) {
    tips.push({ category: 'rp', title: `${RP.pollinator2 - tipsTotal} more TIP${RP.pollinator2 - tipsTotal === 1 ? '' : 's'} for POLLINATOR 2`, detail: `${RP.pollinator2} alliance TIPS earns a second ranking point on top of POLLINATOR 1.`, gain: (RP.pollinator2 - tipsTotal) * POINTS.teleopTip });
  }

  // Cycle time between volleys in TELEOP.
  const volleys = record.shots.filter((s) => s.alliance === settings.alliance && s.counted && s.phase === 'teleop').map((s) => s.matchT);
  if (volleys.length >= 3) {
    const gaps = volleys.slice(1).map((t, i) => t - volleys[i]).filter((g) => g > 1.5 && g < 40).sort((x, y) => x - y);
    if (gaps.length) {
      const median = gaps[Math.floor(gaps.length / 2)];
      if (median > 8) {
        const extraCycles = Math.floor(TIMING.teleop / (median - 2)) - Math.floor(TIMING.teleop / median);
        tips.push({
          category: 'cycling',
          title: `Cut the ${median.toFixed(0)} s cycle by 2 s`,
          detail: `Your median gap between volleys in TELEOP was ${median.toFixed(1)} s. Two seconds faster is about ${extraCycles} more load${extraCycles === 1 ? '' : 's'} per match. Intake while driving toward the HIVE and fire without stopping.`,
          gain: Math.round(extraCycles * LIMITS.carry * per),
        });
      }
    }
  }

  const fouls = a.minorFouls * POINTS.minorFoul + a.majorFouls * POINTS.majorFoul;
  if (fouls) {
    tips.push({ category: 'rules', title: 'Stop giving away foul points', detail: `Your alliance handed the opponent ${fouls} points in fouls. Common BIOBUZZ fouls: controlling more than ${LIMITS.carry} elements, NECTAR in a FLOWER before 1:00, and contacting the HIVE frame to force a TIP.`, gain: fouls });
  }

  return tips.sort((x, y) => y.gain - x.gain);
}

export const PLANNER_DEFAULTS = {
  robots: 2,
  autoLeave: true,
  autoPark: true,
  autoTips: 1,
  cycle: 10,
  capacity: 4,
  accuracy: 80,
  ballsPerTip: 8,
  flowerCaps: 1,
  park: true,
  endDump: true,
};

/** Project one alliance's score from per-robot capability numbers. */
export function project(p) {
  const robots = p.robots;
  const flowerTime = p.flowerCaps * 8;     // per robot doing the capping
  const parkTime = p.park ? 4 : 0;
  const shootTime = Math.max(0, TIMING.teleop - parkTime - Math.ceil(p.flowerCaps / robots) * 8);
  const cycles = Math.floor(shootTime / Math.max(3, p.cycle));
  const madePerRobot = cycles * p.capacity * (p.accuracy / 100);
  const made = madePerRobot * robots;
  const teleopTips = Math.floor(made / p.ballsPerTip);
  const leftover = p.endDump ? Math.min(Math.round(made - teleopTips * p.ballsPerTip), p.ballsPerTip - 1) : 0;

  const auto = {
    leave: p.autoLeave ? robots * POINTS.autoLeave : 0,
    park: p.autoPark ? robots * POINTS.autoPark : 0,
    tips: p.autoTips * POINTS.autoTip,
  };
  const teleop = {
    tips: teleopTips * POINTS.teleopTip,
    cell: leftover * POINTS.cell,
    flowers: p.flowerCaps * (POINTS.bottomNectar + 5 * POINTS.flower),
    park: p.park ? robots * POINTS.teleopPark : 0,
  };
  const autoTotal = auto.leave + auto.park + auto.tips;
  const teleopTotal = teleop.tips + teleop.cell + teleop.flowers + teleop.park;
  const tips = teleopTips + p.autoTips;
  const leavePark = auto.leave + auto.park + teleop.park;
  return {
    auto, teleop, autoTotal, teleopTotal, total: autoTotal + teleopTotal,
    tips, cycles, made: Math.round(made), leftover, flowerTime,
    rp: {
      swarm: leavePark >= RP.swarm,
      pollinator1: tips >= RP.pollinator1,
      pollinator2: tips >= RP.pollinator2,
    },
    leavePark,
  };
}

/** Which single improvement is worth the most points? */
export function sensitivity(p) {
  const base = project(p).total;
  const tries = [
    { label: 'Cycle 1 s faster', change: { cycle: Math.max(3, p.cycle - 1) }, possible: p.cycle > 3 },
    { label: '+10% accuracy', change: { accuracy: Math.min(100, p.accuracy + 10) }, possible: p.accuracy < 100 },
    { label: 'Carry one more element', change: { capacity: Math.min(LIMITS.carry, p.capacity + 1) }, possible: p.capacity < LIMITS.carry },
    { label: 'One more FLOWER cap', change: { flowerCaps: Math.min(4, p.flowerCaps + 1) }, possible: p.flowerCaps < 4 },
    { label: 'One more AUTO TIP', change: { autoTips: p.autoTips + 1 }, possible: p.autoTips < 3 },
    { label: 'PARK at the end', change: { park: true }, possible: !p.park },
    { label: 'AUTO PARK', change: { autoPark: true }, possible: !p.autoPark },
  ];
  return tries
    .filter((t) => t.possible)
    .map((t) => ({ label: t.label, gain: project({ ...p, ...t.change }).total - base }))
    .sort((a, b) => b.gain - a.gain);
}
