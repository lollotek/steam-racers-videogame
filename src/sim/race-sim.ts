/**
 * Race simulation core (doc 03 §4.2), shared by the game and the headless runner (§15.2).
 * Fixed step, no rendering, no DOM. Order per step: commands → vehicles → physics → progress → race rules.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import type { ActionFrame } from '../input/actions';
import { emptyFrame } from '../input/actions';
import { tunables } from '../core/tunables';
import { compileTrack, sampleAt, type CompiledTrack } from '../track/compile';
import type { TrackFile } from '../track/track-format';
import { GROUND_GROUPS, PhysicsVehicle, WALL_GROUPS, type VehicleSpec } from '../vehicles/vehicle-physics';
import { createProgress, standings, updateProgress, type RacerProgress } from '../race/progress';
import { barricadeParams, classifyImpact, speedAfterHit } from '../race/barricades';
import type { Barricade } from '../track/track-format';

export const SIM_STEP = 1 / 60;

tunables.registerGroup('race', [
  { key: 'race.countdown', type: 'number', default: 3, min: 0, max: 10, step: 0.5, unit: 's', label: 'Countdown' },
  { key: 'race.autoReposition', type: 'number', default: 2.5, min: 0.5, max: 10, step: 0.5, unit: 's', label: 'Auto reposition after stuck/flipped' },
  { key: 'race.wallFriction', type: 'number', default: 0.15, min: 0, max: 1, step: 0.01, label: 'Safety wall friction' },
  { key: 'race.impactMinSpeed', type: 'number', default: 2.5, min: 0.5, max: 20, step: 0.1, unit: 'm/s', label: 'Impact event: min speed change' },
]);

let rapierReady: Promise<void> | null = null;
/** Rapier's WASM must be initialised once before creating worlds. */
export function initPhysics(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

export type RacePhase = 'countdown' | 'running' | 'finished';

export interface RacerConfig {
  spec: VehicleSpec;
  name: string;
}

export interface Racer {
  index: number;
  name: string;
  vehicle: PhysicsVehicle;
  progress: RacerProgress;
  /** Seconds spent beyond the barriers (safety net). */
  outOfBounds: number;
  edge: EdgeState;
  /** Horizontal velocity before the physics step (impact detection). */
  preVx: number;
  preVz: number;
}

/** Contact with the track edge (the invisible rail, see race/barricades.ts). */
export interface EdgeState {
  contact: boolean;
  /** -1 = left edge, +1 = right edge. */
  side: number;
  barricade: Barricade;
  /** Seconds of continuous contact. */
  time: number;
  tick: number;
  /** Seconds since the body last touched the edge (contact survives short gaps). */
  away: number;
  /** Speed along the edge (m/s). */
  slide: number;
  /** Contact point and inward normal (world, ground plane). */
  x: number;
  z: number;
  nx: number;
  nz: number;
}

export interface ImpactInfo {
  /** scrape = periodic tick while sliding on an edge; hit/crash = edge impacts; vehicle = anything else. */
  kind: 'scrape' | 'hit' | 'crash' | 'vehicle';
  barricade: Barricade | null;
  /** Speed into the obstacle (m/s); for scrapes, the sliding speed. */
  strength: number;
  x: number;
  z: number;
  /** Normal pointing away from the obstacle. */
  nx: number;
  nz: number;
}

export interface SimEvent {
  type: 'lap' | 'finish' | 'reposition' | 'go' | 'impact';
  racer: number;
  time: number;
  /** Present on `impact` events. M3 turns these into damage (gameplay.md §6.3). */
  impact?: ImpactInfo;
}

const wrapAngle = (a: number) => {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export class RaceSim {
  readonly world: RAPIER.World;
  readonly track: CompiledTrack;
  readonly racers: Racer[] = [];
  phase: RacePhase = 'countdown';
  /** Time since GO (negative during the countdown). */
  clock: number;
  steps = 0;
  readonly events: SimEvent[] = [];
  private idle = emptyFrame();

  constructor(file: TrackFile, racers: RacerConfig[]) {
    this.track = compileTrack(file);
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = SIM_STEP;
    this.clock = -tunables.get('race.countdown');
    this.buildStatic();
    racers.forEach((cfg, i) => {
      const slot = this.track.spawn[i % this.track.spawn.length]!;
      const vehicle = new PhysicsVehicle(RAPIER, this.world, cfg.spec, slot);
      const edge: EdgeState = { contact: false, side: 1, barricade: file.defaultBarricade, time: 0, tick: 0, away: 99, slide: 0, x: 0, z: 0, nx: 0, nz: 0 };
      this.racers.push({ index: i, name: cfg.name, vehicle, progress: createProgress(this.track, slot.x, slot.z), outOfBounds: 0, edge, preVx: 0, preVz: 0 });
    });
  }

  /**
   * Ground slab + safety walls. Vehicles are contained by the invisible rail (applyRail), which has
   * no seams or corners; these walls sit behind it and only catch what the rail could not
   * (gameplay.md §6.3: barricades never break).
   */
  private buildStatic(): void {
    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(600, 1, 600).setCollisionGroups(GROUND_GROUPS).setFriction(0.9), ground);
    const step = 4;
    const n = Math.floor(this.track.length / step);
    const walls = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const off = this.track.halfWidth + 2.6;
    for (let i = 0; i < n; i++) {
      const sp = sampleAt(this.track, i * step + step / 2);
      const h = Math.atan2(sp.tx, sp.tz);
      for (const side of [-1, 1]) {
        // Driver's right of the tangent: (-tz, tx).
        const x = sp.x + -sp.tz * off * side;
        const z = sp.z + sp.tx * off * side;
        // Taller than the visible barricade: a car must never be launched out of the circuit.
        const desc = RAPIER.ColliderDesc.cuboid(0.3, 3.0, step / 2 + 0.25)
          .setTranslation(x, 2.9, z)
          .setRotation({ x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) })
          .setCollisionGroups(WALL_GROUPS)
          .setFriction(tunables.get('race.wallFriction'))
          .setRestitution(0.2);
        this.world.createCollider(desc, walls);
      }
    }
  }

  surfaceAt = (x: number, z: number) => {
    // Nearest sample within the window of any racer is cheap enough for 8 cars; full scan otherwise.
    let best = this.track.samples[0]!;
    let bestD = Infinity;
    for (const r of this.racers) {
      const s = this.track.samples[r.progress.index]!;
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best.surface;
  };

  /** Advance one fixed step. `commands[i]` drives racer i (missing → idle). */
  step(commands: (ActionFrame | null)[]): void {
    const dt = SIM_STEP;
    const running = this.phase === 'running' || this.phase === 'finished';
    const locked = this.phase === 'countdown';
    for (const r of this.racers) {
      const cmd = commands[r.index] ?? this.idle;
      if (cmd.pressed.reposition) this.reposition(r);
      r.vehicle.preStep(cmd, dt, this.surfaceAt, locked);
      const v = r.vehicle.body.linvel();
      r.preVx = v.x;
      r.preVz = v.z;
    }
    this.world.step();
    this.steps++;
    this.clock += dt;
    if (this.phase === 'countdown' && this.clock >= 0) {
      this.phase = 'running';
      this.events.push({ type: 'go', racer: -1, time: 0 });
    }
    for (const r of this.racers) {
      r.vehicle.postStep();
      const p = r.vehicle.curr;
      const v = r.vehicle.body.linvel();
      const smp = this.track.samples[r.progress.index]!;
      const along = v.x * smp.tx + v.z * smp.tz;
      const ev = updateProgress(this.track, r.progress, p.x, p.z, along, this.clock, dt, this.track.file.laps, running);
      if (ev.lapCompleted) this.events.push({ type: 'lap', racer: r.index, time: this.clock });
      if (ev.finished) this.events.push({ type: 'finish', racer: r.index, time: this.clock });
      // Anything that changed the velocity abruptly inside the physics step is an impact (other cars).
      const dv = Math.hypot(v.x - r.preVx, v.z - r.preVz);
      if (dv > tunables.get('race.impactMinSpeed')) {
        const k = 1 / dv;
        this.events.push({ type: 'impact', racer: r.index, time: this.clock, impact: { kind: 'vehicle', barricade: null, strength: dv, x: p.x, z: p.z, nx: (v.x - r.preVx) * k, nz: (v.z - r.preVz) * k } });
      }
      this.applyRail(r, dt);
      r.outOfBounds = Math.abs(r.progress.lateral) > this.track.halfWidth + 2 ? r.outOfBounds + dt : 0;
      if (r.vehicle.troubleTime > tunables.get('race.autoReposition') || p.y < -5 || r.outOfBounds > 1) this.reposition(r);
    }
    if (this.phase === 'running' && this.racers.every((r) => r.progress.finishedAt !== null)) this.phase = 'finished';
  }

  /**
   * The track edge as an invisible rail: keeps the vehicle inside a smooth lateral limit and applies
   * the reaction of the barricade type on that side of the piece (race/barricades.ts).
   */
  private applyRail(r: Racer, dt: number): void {
    const v = r.vehicle;
    const body = v.body;
    const e = r.edge;
    const smp = this.track.samples[r.progress.index]!;
    // Driver's right of the tangent.
    const rx = -smp.tz;
    const rz = smp.tx;
    const lat = r.progress.lateral;
    const side = lat >= 0 ? 1 : -1;
    const type = side > 0 ? smp.right : smp.left;
    const prm = barricadeParams(type);
    // Angle between the body and the track; the box reaches further sideways when it is rotated.
    const theta = wrapAngle(v.heading() - Math.atan2(smp.tx, smp.tz));
    const ext = Math.abs(Math.cos(theta)) * v.halfX + Math.abs(Math.sin(theta)) * v.spec.half.z;
    const pen = Math.abs(lat) - (this.track.halfWidth + prm.inset - ext);
    const av = body.angvel();
    const alignRate = tunables.get('barricades.alignRate');

    if (v.stun > 0) {
      // After a crash: turn the nose back along the track while stopped.
      const w = Math.max(-alignRate * 1.2, Math.min(alignRate * 1.2, -theta * 8));
      body.setAngvel({ x: av.x, y: w, z: av.z }, true);
    }
    // Contact starts at the limit, holds within a band of it, and survives short gaps: a car
    // leaning on the edge slides along it instead of chattering in and out of contact.
    if (pen < (e.contact ? -tunables.get('barricades.contactBand') : 0)) {
      e.away += dt;
      if (e.contact && e.away >= tunables.get('barricades.releaseTime')) {
        e.contact = false;
        e.time = e.tick = 0;
        v.edgeSlow = 1;
      }
      return;
    }

    const lv = body.linvel();
    let vn = (lv.x * rx + lv.z * rz) * side; // into the edge
    let vt = lv.x * smp.tx + lv.z * smp.tz; // along the track
    const pos = body.translation();
    // A new impact needs a real approach; touching again right after a bounce is still the scrape.
    const first = !e.contact && e.away >= tunables.get('barricades.rehitTime');
    e.away = 0;
    e.contact = true;
    e.side = side;
    e.barricade = type;
    e.nx = -rx * side;
    e.nz = -rz * side;
    e.x = pos.x - e.nx * ext;
    e.z = pos.z - e.nz * ext;
    const impact = (kind: ImpactInfo['kind'], strength: number) =>
      this.events.push({ type: 'impact', racer: r.index, time: this.clock, impact: { kind, barricade: type, strength, x: e.x, z: e.z, nx: e.nx, nz: e.nz } });

    const kind = first ? classifyImpact(vn, vt, prm) : 'scrape';
    if (kind === 'crash') {
      // Frontal impact: full stop, small rebound off the edge, restart in 1st gear.
      impact('crash', vn);
      v.crash(tunables.get('barricades.crashStun'));
      vt = 0;
      vn = -1.5;
    } else {
      if (kind === 'hit') {
        impact('hit', vn);
        vt = speedAfterHit(vn, vt, prm);
        if (prm.gearLoss > 0) v.gearbox.gear = Math.max(1, v.gearbox.gear - prm.gearLoss);
      }
      if (vn > 0) vn = 0;
      // Scraping is always slower than the clean line: the engine target drops and drag pulls
      // the speed down to it.
      v.edgeSlow = prm.scrapeSpeed;
      const cap = Math.abs(v.lastOutput?.targetRatio ?? 1) * tunables.get('handling.maxSpeed') * prm.scrapeSpeed;
      const over = Math.abs(vt) - cap;
      if (over > 0) vt -= Math.sign(vt) * Math.min(over, prm.scrapeDrag * dt);
      e.time += dt;
      e.tick += dt;
      if (e.tick >= tunables.get('barricades.scrapeTick')) {
        e.tick = 0;
        impact('scrape', Math.abs(vt));
      }
      // Nose pointing into the edge: turn it parallel so the car always slides on (never pins).
      if (v.stun === 0 && -Math.sin(theta) * side > 0) {
        const goal = Math.cos(theta) >= 0 ? 0 : Math.PI; // keep going the way it was going
        const w = Math.max(-alignRate, Math.min(alignRate, wrapAngle(goal - theta) * 8));
        body.setAngvel({ x: av.x, y: w, z: av.z }, true);
      }
    }
    e.slide = vt;
    body.setLinvel({ x: smp.tx * vt + rx * side * vn, y: lv.y, z: smp.tz * vt + rz * side * vn }, true);
    if (pen > 0) body.setTranslation({ x: pos.x - rx * side * pen, y: pos.y, z: pos.z - rz * side * pen }, true);
  }

  /** Back on the centre line at the current progress, facing along the track (gameplay.md §5.1). */
  reposition(r: Racer): void {
    const smp = this.track.samples[r.progress.index]!;
    r.vehicle.teleport(smp.x, smp.z, Math.atan2(smp.tx, smp.tz));
    r.outOfBounds = 0;
    r.edge.contact = false;
    r.edge.time = r.edge.tick = 0;
    r.edge.away = 99;
    this.events.push({ type: 'reposition', racer: r.index, time: this.clock });
  }

  standings(): number[] {
    return standings(this.racers.map((r) => r.progress));
  }

  /** Pose for the autopilot. */
  pose(i: number) {
    const r = this.racers[i]!;
    return { x: r.vehicle.curr.x, z: r.vehicle.curr.z, heading: r.vehicle.heading(), forwardSpeed: r.vehicle.telemetry.forwardSpeed, s: r.progress.s };
  }

  drainEvents(): SimEvent[] {
    return this.events.splice(0);
  }

  dispose(): void {
    this.world.free();
  }
}
