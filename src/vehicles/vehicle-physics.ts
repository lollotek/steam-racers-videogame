/**
 * Rapier vehicle with an arcade layer (doc 03 §6.1).
 * Ray-cast suspension and tyre friction from Rapier; on top: engine force that chases the
 * gear target speed, steam push, per-surface grip/drag, rear-grip drift and an upright assist.
 * Simulation only: no Three.js.
 */
import { NEUTRAL_TUNE, type VehicleTune } from '../cup/cup';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { ActionFrame } from '../input/actions';
import { tunables } from '../core/tunables';
import { VEHICLE_SCALE } from '../track/units';
import { type GearboxOutput, type GearboxState, createGearbox, stepGearbox } from './gearbox';
import type { BoilerState } from '../rules/boiler';
import { SURFACE_DRAG, SURFACE_GRIP, type Surface } from '../track/track-format';
import { emptyFrame } from '../input/actions';

const LOCKED_FRAME = emptyFrame();

type R = typeof RAPIER;

tunables.registerGroup('handling', [
  { key: 'handling.maxSpeed', type: 'number', default: 32, min: 5, max: 80, step: 0.5, unit: 'm/s', label: 'Max speed (6th)' },
  { key: 'handling.accel', type: 'number', default: 9, min: 1, max: 40, step: 0.5, unit: 'm/s²', label: 'Engine acceleration' },
  { key: 'handling.engineBrake', type: 'number', default: 5, min: 0, max: 30, step: 0.5, unit: 'm/s²', label: 'Engine braking (above gear speed)' },
  { key: 'handling.brake', type: 'number', default: 20, min: 1, max: 60, step: 0.5, unit: 'm/s²', label: 'Brake' },
  { key: 'handling.pushAccel', type: 'number', default: 10, min: 0, max: 40, step: 0.5, unit: 'm/s²', label: 'Steam push accel' },
  { key: 'handling.maxSteer', type: 'number', default: 0.55, min: 0.1, max: 1.2, step: 0.01, unit: 'rad', label: 'Max steer angle (slow)' },
  { key: 'handling.steerAtSpeed', type: 'number', default: 0.35, min: 0.05, max: 1, step: 0.01, label: 'Steer factor at top speed' },
  { key: 'handling.grip', type: 'number', default: 2.2, min: 0.2, max: 12, step: 0.05, label: 'Tyre friction slip' },
  { key: 'handling.sideStiffness', type: 'number', default: 1.0, min: 0.1, max: 4, step: 0.05, label: 'Side friction stiffness' },
  { key: 'handling.driftRearGrip', type: 'number', default: 0.55, min: 0.1, max: 1, step: 0.01, label: 'Rear grip while drifting' },
  { key: 'handling.driftSteer', type: 'number', default: 0.75, min: 0, max: 1, step: 0.01, label: 'Steer needed to drift' },
  { key: 'handling.driftMinSpeed', type: 'number', default: 0.45, min: 0, max: 1, step: 0.01, label: 'Speed fraction needed to drift' },
  { key: 'handling.suspensionStiffness', type: 'number', default: 28, min: 2, max: 100, step: 0.5, label: 'Suspension stiffness' },
  { key: 'handling.suspensionDamping', type: 'number', default: 3.5, min: 0.1, max: 20, step: 0.1, label: 'Suspension damping' },
  { key: 'handling.uprightAssist', type: 'number', default: 9, min: 0, max: 20, step: 0.5, unit: 'rad/s', label: 'Upright assist (spring frequency)' },
  { key: 'handling.maxTiltRate', type: 'number', default: 2.5, min: 0.5, max: 10, step: 0.1, unit: 'rad/s', label: 'Max roll/pitch rate' },
  { key: 'handling.maxYawRate', type: 'number', default: 3.2, min: 1, max: 10, step: 0.1, unit: 'rad/s', label: 'Max yaw rate' },
  { key: 'handling.yawInertia', type: 'number', default: 3.5, min: 1, max: 4, step: 0.05, label: 'Yaw inertia × per halving of vehicle size' },
  { key: 'handling.mass', type: 'number', default: 1400, min: 200, max: 6000, step: 50, unit: 'kg', label: 'Mass' },
]);

/**
 * Collision groups (Rapier InteractionGroups: membership << 16 | filter).
 * Wheel rays must only ever see the road: a ray starting inside a barrier reads as a fully
 * compressed suspension and launches the car.
 */
const GROUP_GROUND = 0x0001;
const GROUP_WALL = 0x0002;
const GROUP_CHASSIS = 0x0004;
export const GROUND_GROUPS = (GROUP_GROUND << 16) | 0xffff;
export const WALL_GROUPS = (GROUP_WALL << 16) | 0xffff;
const CHASSIS_GROUPS = (GROUP_CHASSIS << 16) | 0xffff;
const WHEEL_RAY_GROUPS = (0xffff << 16) | GROUP_GROUND;

export interface VehicleSpec {
  /** Chassis half extents (m): x width, y height, z length. */
  half: { x: number; y: number; z: number };
  wheelRadius: number;
  /** Wheel x offset from the centre line and z offsets of front/rear axles. */
  track: number;
  front: number;
  rear: number;
  /** Driven wheels: rear-wheel drive or all (tracked vehicles). */
  drive: 'rear' | 'all';
  /** Height of the visual root (ground contact) below the body centre. */
  visualOffsetY: number;
  /** Size factor applied by `scaleSpec` (1 = the full-size spec below). */
  scale?: number;
}

export const HOT_ROD: VehicleSpec = { half: { x: 1.0, y: 0.5, z: 2.5 }, wheelRadius: 0.75, track: 1.2, front: 1.8, rear: -1.6, drive: 'rear', visualOffsetY: 1.15 };
export const STEAM_TANK: VehicleSpec = { half: { x: 1.4, y: 0.7, z: 2.7 }, wheelRadius: 0.6, track: 1.35, front: 1.9, rear: -1.9, drive: 'all', visualOffsetY: 1.25 };

export { VEHICLE_SCALE };

/**
 * The spec at `k` × its size. Mass, engine and top speed are unchanged; the physics keeps the same
 * paths in metres: inertia follows the size (∝ k²), the steering angle is reduced so the turning
 * radius stays the same (tan a' = k · tan a), the suspension is stiffer (sag and travel ∝ k).
 */
export function scaleSpec(spec: VehicleSpec, k: number): VehicleSpec {
  const base = spec.scale ?? 1;
  const f = k / base;
  const h = spec.half;
  return {
    ...spec,
    half: { x: h.x * f, y: h.y * f, z: h.z * f },
    wheelRadius: spec.wheelRadius * f,
    track: spec.track * f,
    front: spec.front * f,
    rear: spec.rear * f,
    visualOffsetY: spec.visualOffsetY * f,
    scale: k,
  };
}

export type SurfaceQuery = (x: number, z: number) => Surface;

export interface VehicleTelemetry {
  forwardSpeed: number;
  drifting: boolean;
  surface: Surface;
  wheelsOnGround: number;
}

export class PhysicsVehicle {
  readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  readonly gearbox: GearboxState;
  /** Transforms for interpolation (doc 03 §4.1). */
  readonly prev = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
  readonly curr = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
  telemetry: VehicleTelemetry = { forwardSpeed: 0, drifting: false, surface: 'plate', wheelsOnGround: 0 };
  lastOutput: GearboxOutput | null = null;
  /** Seconds spent upside down / stuck (for auto-reposition). */
  troubleTime = 0;
  /** Seconds left stopped after a crash: engine off, brakes on (set by the race rules). */
  stun = 0;
  /** Engine target multiplier while scraping a barricade (1 = free). */
  edgeSlow = 1;
  /** Hazard zone modifiers for this step (track-features.ts): grip and engine target multipliers. */
  gripMul = 1;
  hazardSlow = 1;
  /** Workshop / difficulty multipliers (doc 04 B3/B4); neutral by default. */
  tune: VehicleTune = { ...NEUTRAL_TUNE };
  /** AI catch-up top speed factor for this step (doc 04 B4; 1 = none). */
  catchUp = 1;
  /** Wreck (0 PF): engine off for good, brakes locked; stays on the track as an obstacle. */
  wrecked = false;
  /** Half width of the collider (covers the wheels). */
  readonly halfX: number;
  /** Mass currently applied to the body (follows the tunable live). */
  private mass = 0;
  /** `handling.yawInertia` currently applied (follows the tunable live). */
  private yawFactor = 0;
  readonly collider: RAPIER.Collider;
  private readonly normal = { x: 0, y: 1, z: 0 };

  constructor(
    private readonly rapier: R,
    private world: RAPIER.World,
    readonly spec: VehicleSpec,
    spawn: { x: number; y?: number; z: number; heading: number },
    boiler?: BoilerState,
  ) {
    this.gearbox = createGearbox(boiler);
    const { half } = spec;
    const bodyDesc = rapier.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, (spawn.y ?? 0) + spec.wheelRadius + 0.6 * (spec.scale ?? 1), spawn.z)
      .setRotation(yawQuat(spawn.heading))
      .setLinearDamping(0.05)
      .setAngularDamping(0.8)
      .setCcdEnabled(true);
    this.body = world.createRigidBody(bodyDesc);
    // The collider covers the wheels too, so a wheel can never sink into a barrier or another car.
    this.halfX = Math.max(half.x, spec.track + 0.3 * (spec.scale ?? 1));
    const col = rapier.ColliderDesc.cuboid(this.halfX, half.y, half.z)
      .setCollisionGroups(CHASSIS_GROUPS)
      .setFriction(0.3)
      .setRestitution(0.05);
    this.collider = world.createCollider(col, this.body);

    this.controller = world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    const y = -half.y * 0.6;
    const rest = 0.45 * (spec.scale ?? 1);
    for (const [x, z] of [[-spec.track, spec.front], [spec.track, spec.front], [-spec.track, spec.rear], [spec.track, spec.rear]] as const) {
      this.controller.addWheel({ x, y, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, rest, spec.wheelRadius);
    }
    this.applyMass(tunables.get('handling.mass'));
    this.capture(this.prev);
    this.capture(this.curr);
  }

  /** Mass, inertia and the mass-dependent suspension limits, always changed together. */
  private applyMass(mass: number): void {
    this.mass = mass;
    this.yawFactor = tunables.get('handling.yawInertia');
    const { half } = this.spec;
    // Yaw inertia of a scaled vehicle (k² × the full size) would make it spin twice as fast at
    // half size (tyre forces unchanged, lever arms × k): `handling.yawInertia` per halving of the
    // size brings the yaw response back to the full-size one (×3.5 at k = 0.5, doc 05 §2).
    const yawComp = Math.pow(this.yawFactor, Math.log2(1 / (this.spec.scale ?? 1)));
    const inertia = {
      x: (mass / 12) * (4 * half.y * half.y + 4 * half.z * half.z),
      y: (mass / 12) * (4 * half.x * half.x + 4 * half.z * half.z) * yawComp,
      z: (mass / 12) * (4 * half.x * half.x + 4 * half.y * half.y),
    };
    // Low centre of mass keeps arcade vehicles on their wheels.
    this.collider.setMassProperties(mass, { x: 0, y: -half.y * 0.9, z: 0 }, inertia, { x: 0, y: 0, z: 0, w: 1 });
    for (let i = 0; i < 4; i++) {
      // A scaled vehicle keeps its sag and travel in proportion (stiffness / k) with the same damping ratio.
      const k = this.spec.scale ?? 1;
      this.controller.setWheelSuspensionStiffness(i, tunables.get('handling.suspensionStiffness') / k);
      this.controller.setWheelSuspensionCompression(i, tunables.get('handling.suspensionDamping') / Math.sqrt(k));
      this.controller.setWheelSuspensionRelaxation(i, (tunables.get('handling.suspensionDamping') * 1.2) / Math.sqrt(k));
      this.controller.setWheelMaxSuspensionForce(i, mass * 60);
      this.controller.setWheelMaxSuspensionTravel(i, 0.35);
    }
  }

  /** Read inputs, set wheel forces. Call before world.step(). */
  preStep(input: ActionFrame, dt: number, surfaceAt: SurfaceQuery, locked: boolean): GearboxOutput {
    const t = (k: string) => tunables.get(k);
    const vc = this.controller;
    const maxSpeed = this.maxSpeed();
    if (t('handling.mass') !== this.mass || t('handling.yawInertia') !== this.yawFactor) this.applyMass(t('handling.mass'));
    const mass = this.mass;
    const fwdSpeed = vc.currentVehicleSpeed();
    if (this.stun > 0) {
      this.stun = Math.max(0, this.stun - dt);
      locked = true;
    }
    if (this.wrecked) locked = true;
    // During the countdown gears are frozen (the start test arrives in M3).
    const out = stepGearbox(this.gearbox, locked ? LOCKED_FRAME : input, dt, fwdSpeed, maxSpeed);
    this.lastOutput = out;

    const pos = this.body.translation();
    const surface = surfaceAt(pos.x, pos.z);
    // Suspension recovers part of what rough surfaces take away; tyres add grip everywhere.
    const rough = this.tune.rough;
    const base = SURFACE_GRIP[surface];
    const grip = (base < 1 ? base + (1 - base) * rough : base) * this.tune.grip * this.gripMul;
    const speedFrac = Math.min(1, Math.abs(fwdSpeed) / maxSpeed);

    // Engine: chase the gear target speed (proportional, capped by acceleration).
    const target = out.targetRatio * maxSpeed * this.edgeSlow * this.hazardSlow;
    const nDriven = this.spec.drive === 'all' ? 4 : 2;
    let accel = 0;
    let brake = 0;
    if (locked) {
      brake = this.wrecked ? 40 : 6; // wheel brake impulse: holds the car on the grid (a wreck harder)
    } else if (out.braking) {
      accel = -Math.min(t('handling.brake'), Math.abs(fwdSpeed) * 4) * Math.sign(fwdSpeed);
    } else {
      const err = target - fwdSpeed;
      const up = t('handling.accel') * this.tune.accel * (1 - 0.4 * speedFrac); // a bit less punch near top speed
      accel = err > 0 ? Math.min(up, err * 3) : Math.max(-t('handling.engineBrake'), err * 3);
      if (out.pushing) accel += t('handling.pushAccel') * this.gearbox.pushBoost;
      accel -= SURFACE_DRAG[surface] * (1 - rough) * speedFrac * Math.sign(fwdSpeed);
    }
    const engine = (mass * accel) / nDriven;
    for (let i = 0; i < 4; i++) {
      const driven = this.spec.drive === 'all' || i >= 2;
      vc.setWheelEngineForce(i, driven ? engine : 0);
      vc.setWheelBrake(i, brake);
    }

    // Steering (front wheels), less lock at speed.
    const steerRaw = -this.gearbox.steer * t('handling.maxSteer') * (1 - (1 - t('handling.steerAtSpeed')) * speedFrac);
    // A scaled vehicle (shorter wheelbase) keeps the turning radius in metres: tan(a') = k · tan(a).
    const steerAngle = Math.atan((this.spec.scale ?? 1) * Math.tan(steerRaw));
    vc.setWheelSteering(0, steerAngle);
    vc.setWheelSteering(1, steerAngle);

    // Grip per surface; drift = rear side grip drops when steering hard at speed.
    const drifting = !locked && Math.abs(this.gearbox.steer) >= t('handling.driftSteer') && speedFrac >= t('handling.driftMinSpeed');
    const slip = t('handling.grip') * grip;
    const side = t('handling.sideStiffness');
    for (let i = 0; i < 4; i++) {
      vc.setWheelFrictionSlip(i, slip);
      vc.setWheelSideFrictionStiffness(i, i >= 2 && drifting ? side * t('handling.driftRearGrip') : side);
    }

    let onGround = 0;
    for (let i = 0; i < 4; i++) if (vc.wheelIsInContact(i)) onGround++;
    this.stabilise(dt, onGround);
    const q = this.body.rotation();
    const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
    this.troubleTime = this.wrecked ? 0 : uy < 0.3 || (Math.abs(fwdSpeed) < 0.3 && Math.abs(target) > 1 && !locked) ? this.troubleTime + dt : 0;

    this.telemetry = { forwardSpeed: fwdSpeed, drifting, surface, wheelsOnGround: onGround };
    // Wheel rays only see static geometry: cars never "climb" on each other and get launched.
    vc.updateVehicle(dt, this.rapier.QueryFilterFlags.EXCLUDE_DYNAMIC, WHEEL_RAY_GROUPS);
    return out;
  }

  /**
   * Arcade stabiliser, applied to the angular velocity itself (mass and inertia independent):
   * a critically damped spring keeps the body up axis on the ground normal, and roll/pitch/yaw
   * rates are capped, so no impact can make the vehicle tumble or spin like a top.
   */
  private stabilise(dt: number, onGround: number): void {
    const w0 = tunables.get('handling.uprightAssist');
    const vc = this.controller;
    // Ground normal: average of the wheel contact normals (world up while airborne).
    let nx = 0;
    let ny = 0;
    let nz = 0;
    if (onGround > 0) {
      for (let i = 0; i < 4; i++) {
        if (!vc.wheelIsInContact(i)) continue;
        const c = vc.wheelContactNormal(i, this.normal);
        if (!c) continue;
        nx += c.x;
        ny += c.y;
        nz += c.z;
      }
    }
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-3 || ny / nl < 0.5) {
      nx = 0;
      ny = 1;
      nz = 0;
    } else {
      nx /= nl;
      ny /= nl;
      nz /= nl;
    }
    const q = this.body.rotation();
    const ux = 2 * (q.x * q.y - q.w * q.z);
    const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
    const uz = 2 * (q.y * q.z + q.w * q.x);
    // Rotation axis bringing the body up onto the normal: up × n (length = sin of the tilt).
    let ex = uy * nz - uz * ny;
    let ey = uz * nx - ux * nz;
    let ez = ux * ny - uy * nx;
    if (ux * nx + uy * ny + uz * nz < 0) {
      // Past 90°: keep pushing at full strength instead of fading towards the upside-down equilibrium.
      const el = Math.hypot(ex, ey, ez);
      if (el > 1e-4) {
        ex /= el;
        ey /= el;
        ez /= el;
      } else {
        ex = 1;
        ey = 0;
        ez = 0;
      }
    }
    const av = this.body.angvel();
    // Split the angular velocity: yaw (about the normal) and tilt (roll + pitch).
    const yaw = av.x * nx + av.y * ny + av.z * nz;
    let tx = av.x - yaw * nx;
    let ty = av.y - yaw * ny;
    let tz = av.z - yaw * nz;
    if (w0 > 0) {
      const damp = Math.max(0, 1 - 2 * w0 * dt);
      tx = tx * damp + ex * w0 * w0 * dt;
      ty = ty * damp + ey * w0 * w0 * dt;
      tz = tz * damp + ez * w0 * w0 * dt;
    }
    this.setCappedAngvel(tx, ty, tz, yaw, nx, ny, nz);
  }

  /** Write back tilt + yaw (about n) angular velocity with both rates capped. */
  private setCappedAngvel(tx: number, ty: number, tz: number, yaw: number, nx: number, ny: number, nz: number): void {
    const maxTilt = tunables.get('handling.maxTiltRate');
    const tl = Math.hypot(tx, ty, tz);
    if (tl > maxTilt) {
      const f = maxTilt / tl;
      tx *= f;
      ty *= f;
      tz *= f;
    }
    const maxYaw = tunables.get('handling.maxYawRate');
    yaw = Math.max(-maxYaw, Math.min(maxYaw, yaw));
    this.body.setAngvel({ x: tx + yaw * nx, y: ty + yaw * ny, z: tz + yaw * nz }, true);
  }

  /** Store the post-step transform (call after world.step()). */
  postStep(): void {
    // Cap what the collision solver just did (barrier and car impacts), about world up.
    const av = this.body.angvel();
    const max = tunables.get('handling.maxYawRate');
    const maxTilt = tunables.get('handling.maxTiltRate');
    if (Math.abs(av.y) > max || Math.hypot(av.x, av.z) > maxTilt) this.setCappedAngvel(av.x, 0, av.z, av.y, 0, 1, 0);
    Object.assign(this.prev, this.curr);
    this.capture(this.curr);
  }

  /** Frontal crash: full stop, back to 1st gear, engine off for `stun` seconds. */
  crash(stun: number): void {
    this.gearbox.gear = 1;
    this.gearbox.pushTimer = 0;
    this.stun = stun;
  }

  /** Put the vehicle at a pose with zero velocity (reposition / respawn). */
  teleport(x: number, z: number, heading: number, y = 0): void {
    this.body.setTranslation({ x, y: y + this.spec.wheelRadius + 0.6 * (this.spec.scale ?? 1), z }, true);
    this.body.setRotation(yawQuat(heading), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.gearbox.gear = 1;
    this.troubleTime = 0;
    this.stun = 0;
    this.edgeSlow = 1;
    this.capture(this.curr);
    Object.assign(this.prev, this.curr);
  }

  /** Top speed of this vehicle (m/s): `handling.maxSpeed` × workshop × catch-up. */
  maxSpeed(): number {
    return tunables.get<number>('handling.maxSpeed') * this.tune.topSpeed * this.catchUp;
  }

  /** Yaw (heading) of the body: 0 = +Z. */
  heading(): number {
    const q = this.body.rotation();
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    return Math.atan2(fx, fz);
  }

  speed(): number {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.z);
  }

  dispose(): void {
    this.world.removeVehicleController(this.controller);
    this.world.removeRigidBody(this.body);
  }

  private capture(o: PhysicsVehicle['curr']): void {
    const p = this.body.translation();
    const q = this.body.rotation();
    o.x = p.x;
    o.y = p.y;
    o.z = p.z;
    o.qx = q.x;
    o.qy = q.y;
    o.qz = q.z;
    o.qw = q.w;
  }
}

export function yawQuat(h: number) {
  return { x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) };
}
