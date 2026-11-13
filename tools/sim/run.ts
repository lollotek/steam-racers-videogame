/**
 * Headless race runner (doc 03 §15.2). Runs AI-vs-AI races faster than real time and prints stats.
 *   npx tsx tools/sim/run.ts [--racers 4] [--laps 3] [--track foundry-01] [--preset tuning.json] [--max 400] [--seed 1] [--trace]
 * M3: AI drivers with the full rules (start test, boiler, hull, ramming, cannon); rules stats per racer.
 */
import { readFileSync } from 'node:fs';
import { RaceSim, SIM_STEP, initPhysics } from '../../src/sim/race-sim';
import { createDriver, driveRacer } from '../../src/ai/driver';
import { HOT_ROD, STEAM_TANK } from '../../src/vehicles/vehicle-physics';
import { tunables, type Preset } from '../../src/core/tunables';
import type { TrackFile } from '../../src/track/track-format';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};
const racers = Number(arg('racers', '4'));
const trackId = arg('track', 'foundry-01');
const maxTime = Number(arg('max', '400'));
const trace = args.includes('--trace');
const presetPath = arg('preset', '');
const seed = Number(arg('seed', '1'));

await initPhysics();
if (presetPath) tunables.applyPreset(JSON.parse(readFileSync(presetPath, 'utf8')) as Preset);
const file = JSON.parse(readFileSync(new URL(`../../src/tracks/${trackId}.json`, import.meta.url), 'utf8')) as TrackFile;
if (args.includes('--laps')) file.laps = Number(arg('laps', '3'));

const sim = new RaceSim(
  file,
  Array.from({ length: racers }, (_, i) => ({ spec: i % 2 === 0 ? HOT_ROD : STEAM_TANK, name: `AI${i + 1}` })),
  seed,
);
const pilots = sim.racers.map((_, i) => createDriver(i, seed, ((i % 3) - 1) * 1.5));
const stats = sim.racers.map(() => ({
  repositions: 0,
  maxSpeed: 0,
  offTrackSteps: 0,
  driftSteps: 0,
  wrongWaySteps: 0,
  start: '',
  damage: {} as Record<string, number>,
  boiler: {} as Record<string, number>,
  shots: 0,
  hits: {} as Record<string, number>,
  rams: 0,
}));
const bump = (o: Record<string, number>, k: string, n = 1) => (o[k] = (o[k] ?? 0) + n);
const t0 = performance.now();
while (sim.phase !== 'finished' && sim.clock < maxTime) {
  const cmds = pilots.map((p) => driveRacer(p, sim));
  sim.step(cmds);
  for (const e of sim.drainRuleEvents()) {
    if (trace) console.log(`[${sim.clock.toFixed(2)}] ${JSON.stringify(e)}`);
    if (e.type === 'start') stats[e.racer]!.start = e.outcome;
    if (e.type === 'damage') bump(stats[e.racer]!.damage, e.source, e.pf);
    if (e.type === 'boiler') bump(stats[e.racer]!.boiler, e.outcome);
    if (e.type === 'fire') stats[e.racer]!.shots++;
    if (e.type === 'hit') bump(stats[e.from]!.hits, e.zone);
    if (e.type === 'ram') {
      stats[e.a]!.rams++;
      stats[e.b]!.rams++;
    }
  }
  for (const e of sim.drainEvents()) {
    if (e.type === 'reposition') stats[e.racer]!.repositions++;
    if (trace && e.type !== 'reposition') console.log(`[${e.time.toFixed(2)}] ${e.type} racer=${e.racer}`);
  }
  sim.racers.forEach((r, i) => {
    const s = stats[i]!;
    s.maxSpeed = Math.max(s.maxSpeed, r.vehicle.speed());
    if (r.progress.offTrack) s.offTrackSteps++;
    if (r.vehicle.telemetry.drifting) s.driftSteps++;
    if (r.progress.wrongWayTime > 0) s.wrongWaySteps++;
  });
  if (trace && sim.steps % 300 === 0) {
    const r = sim.racers[0]!;
    console.log(`t=${sim.clock.toFixed(1)} gear=${r.vehicle.gearbox.gear} v=${r.vehicle.speed().toFixed(1)} s=${r.progress.s.toFixed(0)} lap=${r.progress.lap} lat=${r.progress.lateral.toFixed(1)} surf=${r.vehicle.telemetry.surface}`);
  }
}
const wall = (performance.now() - t0) / 1000;
const order = sim.standings();
const result = {
  track: file.id,
  length: Math.round(sim.track.length),
  laps: file.laps,
  simSeconds: Number(sim.clock.toFixed(2)),
  wallSeconds: Number(wall.toFixed(2)),
  speedup: Number((sim.steps * SIM_STEP / wall).toFixed(1)),
  finished: sim.phase === 'finished',
  standings: order.map((i) => {
    const r = sim.racers[i]!;
    const s = stats[i]!;
    const steps = sim.steps;
    return {
      name: r.name,
      vehicle: r.vehicle.spec === HOT_ROD ? 'hotrod' : 'tank',
      finish: r.progress.finishedAt !== null ? Number(r.progress.finishedAt.toFixed(2)) : null,
      laps: r.progress.lap,
      lapTimes: r.progress.lapTimes.map((t) => Number(t.toFixed(2))),
      bestLap: r.progress.bestLap !== null ? Number(r.progress.bestLap.toFixed(2)) : null,
      maxSpeedKmh: Math.round(s.maxSpeed * 3.6),
      repositions: s.repositions,
      offTrackPct: Number(((s.offTrackSteps / steps) * 100).toFixed(1)),
      driftPct: Number(((s.driftSteps / steps) * 100).toFixed(1)),
      wrongWayPct: Number(((s.wrongWaySteps / steps) * 100).toFixed(1)),
      start: s.start,
      pf: r.rules.hull.pf,
      wrecked: r.vehicle.wrecked,
      damageTaken: s.damage,
      boiler: s.boiler,
      shots: s.shots,
      hitsDealt: s.hits,
      rams: s.rams,
    };
  }),
};
console.log(JSON.stringify(result, null, 2));
sim.dispose();
