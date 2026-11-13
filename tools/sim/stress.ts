/**
 * Physics stress probe: abusive driving (wall grinding, zig-zag at speed, heavy masses) and
 * stability metrics. A healthy vehicle never tumbles, never flies and never needs a reposition.
 *   npx tsx tools/sim/stress.ts [--verbose]
 */
import { RaceSim, initPhysics } from '../../src/sim/race-sim';
import { HOT_ROD, STEAM_TANK, type VehicleSpec } from '../../src/vehicles/vehicle-physics';
import { emptyFrame, type ActionFrame } from '../../src/input/actions';
import { tunables } from '../../src/core/tunables';
import type { TrackFile } from '../../src/track/track-format';
import { readFileSync } from 'node:fs';

const verbose = process.argv.includes('--verbose');
await initPhysics();
const file = JSON.parse(readFileSync(new URL('../../src/tracks/foundry-01.json', import.meta.url), 'utf8')) as TrackFile;

type Driver = (step: number, f: ActionFrame, sim: RaceSim) => void;

const drivers: Record<string, Driver> = {
  // Shift up and never steer: straight into the first barrier, then grind along it.
  straight: (n, f) => {
    f.pressed.steamPush = f.held.steamPush = n % 70 === 0;
  },
  // Full lock right, flat out.
  lockRight: (n, f) => {
    f.steer = 1;
    f.pressed.steamPush = f.held.steamPush = n % 70 === 0;
  },
  // Violent left/right at speed, bouncing between the barriers.
  zigzag: (n, f) => {
    f.steer = Math.floor(n / 45) % 2 ? 1 : -1;
    f.pressed.steamPush = f.held.steamPush = n % 70 === 0;
  },
  // Slow zig-zag: long diagonal runs into each barrier at high speed.
  slalom: (n, f) => {
    f.steer = Math.floor(n / 150) % 2 ? 0.6 : -0.6;
    f.pressed.steamPush = f.held.steamPush = n % 70 === 0;
  },
  // Pseudo-random abuse: steer, pushes, brakes, reverse.
  chaos: (n, f) => {
    const r = (k: number) => Math.abs(Math.sin(n * 0.013 * k + k * 7.1));
    f.steer = Math.sin(n * 0.021) > 0 ? 1 : -1;
    if (r(3) > 0.6) f.steer *= 0.3;
    f.pressed.steamPush = f.held.steamPush = n % 50 === 0;
    f.held.gearDown = r(5) > 0.93;
  },
};

interface Metrics {
  maxTilt: number;
  maxY: number;
  maxAngVel: number;
  maxYawRate: number;
  airSteps: number;
  repositions: number;
  restBounce: number;
  maxSpeed: number;
}

function runCase(spec: VehicleSpec, mass: number, driver: Driver, seconds = 60): Metrics {
  tunables.set('handling.mass', mass);
  const sim = new RaceSim(JSON.parse(JSON.stringify(file)) as TrackFile, [{ spec, name: 'x' }]);
  const m: Metrics = { maxTilt: 0, maxY: 0, maxAngVel: 0, maxYawRate: 0, airSteps: 0, repositions: 0, restBounce: 0, maxSpeed: 0 };
  const f = emptyFrame();
  const v = sim.racers[0]!.vehicle;
  let restY = 0;
  const steps = Math.round(seconds * 60);
  for (let n = 0; n < steps; n++) {
    f.steer = 0;
    f.pressed.steamPush = f.held.steamPush = f.held.gearDown = f.pressed.gearDown = false;
    if (sim.phase !== 'countdown') driver(n, f, sim);
    sim.step([f]);
    m.repositions += sim.drainEvents().filter((e) => e.type === 'reposition').length;
    const q = v.body.rotation();
    const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
    const tilt = (Math.acos(Math.max(-1, Math.min(1, uy))) * 180) / Math.PI;
    const av = v.body.angvel();
    const y = v.body.translation().y;
    if (sim.phase === 'countdown') {
      // Settled height in the last second of the countdown; bounce = deviation from it.
      if (sim.clock > -1.5 && sim.clock <= -1) restY = y;
      if (sim.clock > -1) m.restBounce = Math.max(m.restBounce, Math.abs(y - restY));
      continue;
    }
    m.maxTilt = Math.max(m.maxTilt, tilt);
    m.maxY = Math.max(m.maxY, y - restY);
    m.maxAngVel = Math.max(m.maxAngVel, Math.hypot(av.x, av.z));
    m.maxYawRate = Math.max(m.maxYawRate, Math.abs(av.y));
    m.maxSpeed = Math.max(m.maxSpeed, v.speed());
    if (v.telemetry.wheelsOnGround === 0) m.airSteps++;
  }
  sim.dispose();
  return m;
}

const LIMITS = { maxTilt: 15, maxY: 0.3, maxYawRate: 3.5, restBounce: 0.02, airSteps: 5, repositions: 0 };
let failures = 0;
const rows: string[] = [];
for (const [specName, spec] of [['hotrod', HOT_ROD], ['tank', STEAM_TANK]] as const) {
  for (const mass of [400, 1400, 3000, 4500, 6000]) {
    for (const [name, driver] of Object.entries(drivers)) {
      const m = runCase(spec, mass, driver);
      const bad = (Object.keys(LIMITS) as (keyof typeof LIMITS)[]).filter((k) => m[k] > LIMITS[k]);
      if (bad.length) failures++;
      if (bad.length || verbose)
        rows.push(
          `${bad.length ? 'FAIL' : 'ok  '} ${specName.padEnd(6)} m=${String(mass).padEnd(5)} ${name.padEnd(9)} tilt=${m.maxTilt.toFixed(1).padStart(6)}° y=+${m.maxY.toFixed(2)} roll/pitch=${m.maxAngVel.toFixed(1)} yaw=${m.maxYawRate.toFixed(1)} air=${m.airSteps} repos=${m.repositions} bounce=${m.restBounce.toFixed(3)} vmax=${m.maxSpeed.toFixed(0)} ${bad.join(',')}`,
        );
    }
  }
}
console.log(rows.join('\n'));
console.log(failures ? `${failures} unstable cases` : 'all stable');
process.exit(failures ? 1 : 0);
