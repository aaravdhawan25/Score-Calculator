// Deterministic stand-in for the vision model, used by `npm run dev:mock`
// so the whole pipeline can be exercised without an API key.

function rand(seed) {
  let x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

export function mockResponse(task, frames, meta) {
  const al = meta.alliance || 'red';
  const opp = al === 'red' ? 'blue' : 'red';
  if (task === 'segment') {
    const events = [];
    const from = Number(meta.from), to = Number(meta.to);
    for (let t = Math.ceil(from / 7) * 7; t <= to; t += 7) {
      const r = rand(t);
      const count = 2 + Math.floor(r * 3);
      events.push({ t, type: 'launch', alliance: al, robot: `${al} robot`, element: r > 0.85 ? 'nectar' : 'pollen', count, made: Math.max(0, count - (r > 0.6 ? 1 : 0)), confidence: 0.7, note: 'mock volley' });
      if (meta.opponent && r > 0.4) events.push({ t: t + 2, type: 'launch', alliance: opp, robot: `${opp} robot`, element: 'pollen', count: 3, made: 2, confidence: 0.6, note: 'mock' });
      if (Math.floor(t / 7) % 3 === 2) events.push({ t: t + 1, type: 'hive_tip', alliance: al, confidence: 0.8, note: 'mock tip' });
      if (meta.opponent && Math.floor(t / 7) % 4 === 3) events.push({ t: t + 3, type: 'hive_tip', alliance: opp, confidence: 0.7, note: 'mock tip' });
    }
    return { events: events.filter((e) => e.t >= from && e.t <= to), summary: 'Mock analysis.' };
  }
  if (task === 'checkpoint') {
    if (meta.kind === 'auto_end') {
      const n = meta.robots || 1;
      return { [al]: { left: n, parked: 0 }, [opp]: { left: meta.opponent ? n : 0, parked: 0 }, confidence: 0.6, note: 'mock' };
    }
    return {
      [al]: { cell: 3, garden: 2, parked: meta.robots || 1 },
      [opp]: { cell: meta.opponent ? 2 : 0, garden: meta.opponent ? 1 : 0, parked: meta.opponent ? 1 : 0 },
      flowers: [
        { position: 'near wall', elements: 5, owner: al, bottom: al },
        { position: 'far wall', elements: 4, owner: meta.opponent ? opp : null, bottom: meta.opponent ? opp : null },
      ],
      confidence: 0.55,
      note: 'mock',
    };
  }
  if (task === 'robot') {
    return {
      robots: [{
        label: `${al} robot`,
        subsystems: [
          { id: 'mecanum', name: 'Mecanum drivetrain', evidence: 'Strafes sideways between launch spots', performance: 'strong' },
          { id: 'wide_intake', name: 'Full-width roller intake', evidence: 'Picks up balls across the bumper', performance: 'ok' },
          { id: 'indexer', name: '4-ball indexer', evidence: 'Holds a full load before shooting', performance: 'ok' },
          { id: 'flywheel', name: 'Single flywheel launcher', evidence: 'Arcing shots from mid-field', performance: 'ok' },
        ],
        capacity_estimate: 4,
        cycle_seconds_estimate: 9,
        launch_positions: 'mid-field, both sides of the HIVE',
        notes: 'Mock robot profile.',
      }],
    };
  }
  if (task === 'coach') {
    return {
      headline: 'Mock coaching: your shooting is fine, your endgame is leaving points behind.',
      tips: [
        { title: 'Dump the last load into the CELL', detail: 'Mock tip. Anything in the upward CELL at the buzzer is 2 points each.', gain: 8, category: 'endgame' },
      ],
      weaponize: [
        { subsystem: 'Mecanum drivetrain', play: 'Strafe-to-swap', how: 'Mock. Strafe between both launch zones as the HIVE flips.' },
      ],
    };
  }
  return {};
}
