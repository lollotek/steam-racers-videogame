import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { GROUND_GROUPS, HOT_ROD, STEAM_TANK, PhysicsVehicle, scaleSpec, type VehicleSpec } from '../../src/vehicles/vehicle-physics';
import { emptyFrame } from '../../src/input/actions';

beforeAll(async () => {
  await RAPIER.init();
});

const DT = 1 / 60;

/**
 * Flat ground, 5th gear up to speed, then a step steer held for 1 s.
 * Returns the yaw rate peak and the time to reach 63 % of it.
 */
function stepSteer(base: VehicleSpec, k: number, steer: number) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 2000).setTranslation(0, -0.5, 0).setCollisionGroups(GROUND_GROUPS));
  const v = new PhysicsVehicle(RAPIER, world, scaleSpec(base, k), { x: 0, z: -1500, heading: 0 });
  const f = emptyFrame();
  const tick = () => {
    v.preStep(f, DT, () => 'plate', false);
    world.step();
    v.postStep();
  };
  for (let n = 0; n < 1100; n++) {
    v.gearbox.gear = 5;
    tick();
  }
  f.steer = steer;
  const rates: number[] = [];
  for (let n = 0; n < 60; n++) {
    tick();
    rates.push(Math.abs(v.body.angvel().y));
  }
  world.free();
  const peak = Math.max(...rates);
  const t63 = (rates.findIndex((r) => r >= 0.63 * peak) + 1) * DT;
  return { peak, t63 };
}

describe('half-size vehicles keep the full-size yaw response', () => {
  for (const [name, spec] of [['hot rod', HOT_ROD], ['tank', STEAM_TANK]] as const) {
    it(`${name}: same yaw peak and rise time as at full size`, () => {
      for (const steer of [0.4, 1]) {
        const full = stepSteer(spec, 1, steer);
        const half = stepSteer(spec, 0.5, steer);
        expect(half.peak / full.peak).toBeGreaterThan(0.9);
        expect(half.peak / full.peak).toBeLessThan(1.1);
        expect(Math.abs(half.t63 - full.t63)).toBeLessThanOrEqual(2.5 * DT);
      }
    });
  }
});
