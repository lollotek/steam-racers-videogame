/**
 * Rules layer of the race (doc 03 §6.1, gameplay.md §4–7): start test, boiler, hull, ramming,
 * front cannon. Runs inside RaceSim's fixed step, deterministic (gameplay RNG stream).
 * Physics stays in PhysicsVehicle; this layer only reads poses and writes gears, timers,
 * velocities and events.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import { tunables } from '../core/tunables';
import { Rng, hashString } from '../core/rng';
import type { ActionFrame } from '../input/actions';
import { type BoilerState, createBoiler, stepBoiler } from '../rules/boiler';
import { type StartTest, createStartTest, resolveStart, startEffect, stepStartTest, type StartOutcome } from '../rules/start-test';
import { type HullState, createHull, damage, edgeDamage, ram, scrapeDamage } from '../rules/hull';
import { type CannonState, type HitZone, coneHalfAngle, createCannon, isLocked, pickTarget, shotAngle, shotWobble, zoneDamage, zoneOf } from '../rules/cannon';
import type { VehicleStats } from '../rules/stats';
import type { BoilerOutcome, BoilerTestKind } from '../rules/boiler';
import type { Barricade, HazardKind, PickupKind } from '../track/track-format';
import { freePush } from '../vehicles/gearbox';
import type { PhysicsVehicle } from '../vehicles/vehicle-physics';
import type { CompiledTrack } from '../track/compile';
import { blockedAt } from '../rules/sight';

/** Per-racer rules state. */
export interface RacerRules {
  stats: VehicleStats;
  boiler: BoilerState;
  hull: HullState;
  cannon: CannonState;
  start: StartTest;
  startOutcome: StartOutcome | null;
  /** Weapons unlocked (after `weapons.unlockLap` laps). */
  armed: boolean;
  /** Cup money collected on the track this race (money bags, doc 04 A3). */
  money: number;
  /** Seconds of rune-pylon contact towards the next PV drain. */
  pylonAcc: number;
}

export type RuleEvent =
  | { type: 'start'; racer: number; outcome: StartOutcome }
  | { type: 'boilerTest'; racer: number; kind: BoilerTestKind }
  | { type: 'boiler'; racer: number; outcome: BoilerOutcome }
  | { type: 'vent'; racer: number; x: number; z: number }
  | { type: 'damage'; racer: number; pf: number; source: 'edge' | 'scrape' | 'ram' | 'shot' | 'boiler' | 'shock' | 'hazard' }
  /** Rune pylon contact drained steam. */
  | { type: 'pylon'; racer: number; x: number; z: number }
  | { type: 'pickup'; racer: number; id: number; kind: PickupKind; amount: number; x: number; y: number; z: number }
  /** Jump landing: clean (+PV) or hard (−1 gear). */
  | { type: 'landing'; racer: number; clean: boolean; air: number; pv: number }
  /** A hazard effect hit a racer (damage, crash, steam). */
  | { type: 'hazard'; racer: number; id: number; kind: HazardKind; effect: 'damage' | 'crash' | 'steam'; amount: number }
  | { type: 'wreck'; racer: number }
  | { type: 'ram'; a: number; b: number; winner: number; x: number; z: number }
  | { type: 'armed'; racer: number }
  /** `blocked`: the shell stopped on a barricade at (tx, tz). */
  | { type: 'fire'; racer: number; target: number; x: number; z: number; tx: number; tz: number; zone: HitZone; flight: number; blocked: boolean }
  | { type: 'hit'; racer: number; from: number; zone: HitZone; pf: number; x: number; z: number };

export interface RulesRacer {
  index: number;
  vehicle: PhysicsVehicle;
  /** Nearest centre-line sample (line of sight search hint) and laps completed. */
  progress: { index: number; lap: number };
  rules: RacerRules;
  /** Finished racers take no more damage. */
  finished: boolean;
  /** Horizontal velocity before the physics step. */
  preVx: number;
  preVz: number;
}

interface PendingShot {
  from: number;
  to: number;
  zone: HitZone;
  t: number;
  x: number;
  z: number;
}

interface Cloud {
  x: number;
  z: number;
  life: number;
}

export function createRacerRules(stats: VehicleStats, pole: boolean): RacerRules {
  return {
    stats,
    boiler: createBoiler(stats.cal, stats.aff),
    hull: createHull(stats.pf, stats.res),
    cannon: createCannon(),
    start: createStartTest(stats.man, stats.aff, pole),
    startOutcome: null,
    armed: tunables.get<number>('weapons.unlockLap') === 0,
    money: 0,
    pylonAcc: 0,
  };
}

const CLOUD_RADIUS = 3.5;

export class RaceRules {
  readonly rng: Rng;
  readonly events: RuleEvent[] = [];
  readonly clouds: Cloud[] = [];
  private pending: PendingShot[] = [];
  private pairCooldown: Float32Array;

  constructor(
    seed: number,
    private readonly racers: RulesRacer[],
    private readonly world: RAPIER.World,
    private readonly track: CompiledTrack,
  ) {
    this.rng = new Rng(hashString(`${seed}:gameplay`));
    this.pairCooldown = new Float32Array(racers.length * racers.length);
  }

  /** Countdown: the start test needle follows STEAM held. */
  countdownStep(r: RulesRacer, cmd: ActionFrame, dt: number, timeToGo: number): void {
    stepStartTest(r.rules.start, cmd.held.steamPush, dt, timeToGo);
  }

  /** GO: resolve every start test, apply gears, free pushes, stalls and the calm time. */
  go(): void {
    const calm = tunables.get<number>('start.calmTime');
    for (const r of this.racers) {
      const o = resolveStart(r.rules.start);
      r.rules.startOutcome = o;
      const e = startEffect(o);
      const g = r.vehicle.gearbox;
      g.gear = e.gear;
      if (e.push > 0) freePush(g, e.push);
      if (e.stall > 0) r.vehicle.stun = e.stall;
      g.noPush = calm + e.stall;
      this.events.push({ type: 'start', racer: r.index, outcome: o });
    }
  }

  /** Before the vehicle step: boiler, cannon targeting and fire. */
  preStep(r: RulesRacer, cmd: ActionFrame, dt: number, clock: number): void {
    const v = r.vehicle;
    const rr = r.rules;
    if (v.wrecked) return;
    const res = stepBoiler(rr.boiler, dt, cmd.pressed.vent, this.rng);
    if (res.testStarted) this.events.push({ type: 'boilerTest', racer: r.index, kind: res.testStarted });
    if (res.vented) {
      const h = v.heading();
      const x = v.curr.x - Math.sin(h) * 4;
      const z = v.curr.z - Math.cos(h) * 4;
      this.clouds.push({ x, z, life: tunables.get<number>('boiler.ventCloud') });
      this.events.push({ type: 'vent', racer: r.index, x, z });
    }
    if (res.outcome) this.boilerOutcome(r, res.outcome, clock);

    // Cannon: lock on the rival ahead, track how steady the shooter is.
    const c = rr.cannon;
    const g = v.gearbox;
    c.cooldown = Math.max(0, c.cooldown - dt);
    c.sinceManoeuvre = v.lastOutput?.gearChanged || v.lastOutput?.pushed ? 0 : c.sinceManoeuvre + dt;
    c.steady = Math.abs(g.steer) < 0.2 ? c.steady + dt : 0;
    // Locked weapons: no targeting at all. Armed: only rivals in sight (barricades block shells).
    const cands = rr.armed
      ? this.racers
          .filter((o) => o !== r && !o.vehicle.wrecked && blockedAt(this.track, v.curr.x, v.curr.z, o.vehicle.curr.x, o.vehicle.curr.z, r.progress.index) === null)
          .map((o) => ({ index: o.index, x: o.vehicle.curr.x, z: o.vehicle.curr.z }))
      : [];
    const target = pickTarget(v.curr.x, v.curr.z, v.heading(), cands);
    if (target !== c.target) c.lockTime = 0;
    c.target = target;
    if (target >= 0) c.lockTime += dt;

    const calm = clock < tunables.get<number>('start.calmTime');
    if (cmd.pressed.fireFront && rr.armed && !calm && c.ammo > 0 && c.cooldown === 0) this.fire(r);
  }

  /** After the physics step: shells in flight, ramming, clouds. */
  postStep(dt: number, clock: number): void {
    for (const s of this.pending) s.t -= dt;
    for (const s of this.pending.filter((p) => p.t <= 0)) this.resolveShot(s, clock);
    this.pending = this.pending.filter((p) => p.t > 0);
    for (const c of this.clouds) c.life -= dt;
    for (let i = this.clouds.length - 1; i >= 0; i--) if (this.clouds[i]!.life <= 0) this.clouds.splice(i, 1);
    for (let i = 0; i < this.pairCooldown.length; i++) this.pairCooldown[i] = Math.max(0, this.pairCooldown[i]! - dt);
    for (const r of this.racers) r.rules.hull.rammedFor = Math.max(0, r.rules.hull.rammedFor - dt);
    this.detectRams(clock);
  }

  /** Edge events from the rail (gameplay.md §6.3). */
  edgeImpact(r: RulesRacer, type: Barricade, kind: 'hit' | 'crash', clock: number): void {
    this.hurt(r, edgeDamage(type, kind, r.rules.hull.rammedFor > 0), 'edge', clock);
    if (type === 'runepylon') this.pylonDrain(r);
  }

  edgeContact(r: RulesRacer, type: Barricade, contact: boolean, dt: number, clock: number): void {
    const pf = scrapeDamage(r.rules.hull, type, contact, dt);
    if (pf > 0) this.hurt(r, pf, 'scrape', clock);
    // Rune pylons (doc 04 §5): the arc field drains 1 PV on a hit and every few seconds of scraping.
    if (contact && type === 'runepylon') {
      r.rules.pylonAcc += dt;
      if (r.rules.pylonAcc >= tunables.get<number>('barricades.runepylon.drainEvery')) {
        r.rules.pylonAcc = 0;
        this.pylonDrain(r);
      }
    } else r.rules.pylonAcc = 0;
  }

  private pylonDrain(r: RulesRacer): void {
    const b = r.rules.boiler;
    if (b.pv <= 0 || r.vehicle.wrecked) return;
    b.pv = Math.max(0, b.pv - tunables.get<number>('barricades.runepylon.drain'));
    this.events.push({ type: 'pylon', racer: r.index, x: r.vehicle.curr.x, z: r.vehicle.curr.z });
  }

  lapCompleted(r: RulesRacer): void {
    const rr = r.rules;
    if (!rr.armed) {
      // The first laps are a clean race: weapons unlock after `weapons.unlockLap` laps.
      if (r.progress.lap >= tunables.get<number>('weapons.unlockLap')) {
        rr.armed = true;
        this.events.push({ type: 'armed', racer: r.index });
      }
      return;
    }
    rr.cannon.ammo += tunables.get<number>('weapons.cannon.lapAmmo');
  }

  hurt(r: RulesRacer, pf: number, source: Extract<RuleEvent, { type: 'damage' }>['source'], clock: number, armour = false): number {
    if (r.finished || r.vehicle.wrecked) return 0;
    const lost = damage(r.rules.hull, pf, clock, armour);
    if (lost > 0) this.events.push({ type: 'damage', racer: r.index, pf: lost, source });
    if (r.rules.hull.wrecked && !r.vehicle.wrecked) {
      r.vehicle.wrecked = true;
      r.vehicle.gearbox.gear = 1;
      r.vehicle.gearbox.pushTimer = 0;
      r.rules.boiler.test = null;
      this.events.push({ type: 'wreck', racer: r.index });
    }
    return lost;
  }

  private boilerOutcome(r: RulesRacer, o: BoilerOutcome, clock: number): void {
    const t = (k: string) => tunables.get<number>(k);
    const v = r.vehicle;
    const g = v.gearbox;
    this.events.push({ type: 'boiler', racer: r.index, outcome: o });
    if (o === 'emergency') {
      g.gear = Math.max(1, g.gear - t('boiler.emergencyGears'));
      g.pushTimer = 0;
      this.hurt(r, t('boiler.emergencyDamage'), 'boiler', clock);
    } else if (o === 'valves') {
      // Hard brake: most of the speed is gone.
      const lv = v.body.linvel();
      v.body.setLinvel({ x: lv.x * 0.35, y: lv.y, z: lv.z * 0.35 }, true);
      g.gear = Math.max(1, g.gear - 2);
      g.pushTimer = 0;
      this.hurt(r, t('boiler.burstDamage'), 'boiler', clock);
    } else if (o === 'explosion') {
      v.crash(t('boiler.explosionStall'));
      const lv = v.body.linvel();
      v.body.setLinvel({ x: lv.x * 0.2, y: lv.y, z: lv.z * 0.2 }, true);
      this.hurt(r, Math.ceil(r.rules.hull.max / 2), 'boiler', clock);
      this.shockWave(r, clock);
    }
  }

  /** Explosion: neighbours are pushed away (and shaken by the presentation). */
  private shockWave(src: RulesRacer, clock: number): void {
    const rad = tunables.get<number>('boiler.shockRadius');
    const imp = tunables.get<number>('boiler.shockImpulse');
    for (const o of this.racers) {
      if (o === src || o.vehicle.wrecked) continue;
      const dx = o.vehicle.curr.x - src.vehicle.curr.x;
      const dz = o.vehicle.curr.z - src.vehicle.curr.z;
      const d = Math.hypot(dx, dz);
      if (d > rad || d < 1e-3) continue;
      const k = (imp * (1 - d / rad)) / d;
      const lv = o.vehicle.body.linvel();
      o.vehicle.body.setLinvel({ x: lv.x + dx * k, y: lv.y + 1.5, z: lv.z + dz * k }, true);
      this.hurt(o, 1, 'shock', clock);
    }
  }

  private fire(r: RulesRacer): void {
    const t = (k: string) => tunables.get<number>(k);
    const c = r.rules.cannon;
    const v = r.vehicle;
    c.ammo--;
    c.cooldown = t('weapons.cannon.cooldown');
    const h = v.heading();
    const nx = v.curr.x + Math.sin(h) * v.spec.half.z;
    const nz = v.curr.z + Math.cos(h) * v.spec.half.z;
    const range = t('weapons.cannon.range');
    if (c.target < 0) {
      // Nothing in the lock cone: the shell flies straight on.
      const f = blockedAt(this.track, nx, nz, nx + Math.sin(h) * range, nz + Math.cos(h) * range, r.progress.index) ?? 1;
      const tx = nx + Math.sin(h) * range * f;
      const tz = nz + Math.cos(h) * range * f;
      this.events.push({ type: 'fire', racer: r.index, target: -1, x: nx, z: nz, tx, tz, zone: 'miss', flight: (range * f) / t('weapons.cannon.speed'), blocked: f < 1 });
      return;
    }
    const tgt = this.racers[c.target]!;
    const tv = tgt.vehicle;
    const dx = tv.curr.x - nx;
    const dz = tv.curr.z - nz;
    const dist = Math.hypot(dx, dz);
    const bearing = Math.atan2(dx, dz);
    let half = coneHalfAngle({
      shooterGear: v.gearbox.gear,
      targetGear: tv.gearbox.gear,
      steer: Math.abs(v.gearbox.steer),
      steady: c.steady,
      sinceManoeuvre: c.sinceManoeuvre,
      throughCloud: this.cloudBetween(nx, nz, tv.curr.x, tv.curr.z),
    });
    if (!isLocked(c)) half += t('weapons.cone.manoeuvre');
    const off = shotAngle(half, this.rng);
    // Silhouette half width seen along the shot line.
    const rel = tv.heading() - bearing;
    const halfW = Math.abs(Math.cos(rel)) * tv.halfX + Math.abs(Math.sin(rel)) * tv.spec.half.z;
    const lateral = dist * Math.tan(off) + shotWobble(this.rng);
    const zone = zoneOf(lateral, halfW);
    const a = bearing + Math.atan2(lateral, dist);
    let reach = zone === 'miss' ? range : dist;
    // The actual shell line may still clip a barricade (cone offset, target moving behind a bend).
    const f = blockedAt(this.track, nx, nz, nx + Math.sin(a) * reach, nz + Math.cos(a) * reach, r.progress.index);
    const blocked = f !== null;
    if (blocked) reach *= f;
    const hitZone: HitZone = blocked ? 'miss' : zone;
    const flight = reach / t('weapons.cannon.speed');
    const tx = nx + Math.sin(a) * reach;
    const tz = nz + Math.cos(a) * reach;
    this.events.push({ type: 'fire', racer: r.index, target: c.target, x: nx, z: nz, tx, tz, zone: hitZone, flight, blocked });
    if (hitZone !== 'miss') this.pending.push({ from: r.index, to: c.target, zone: hitZone, t: flight, x: tx, z: tz });
  }

  private resolveShot(s: PendingShot, clock: number): void {
    const tgt = this.racers[s.to]!;
    if (tgt.vehicle.wrecked) return;
    let pf = 0;
    if (s.zone !== 'edge') pf = this.hurt(tgt, zoneDamage(s.zone), 'shot', clock, true);
    // Only a centre hit applies the special effect: −1 gear.
    if (s.zone === 'centre' && !tgt.finished) tgt.vehicle.gearbox.gear = Math.max(1, tgt.vehicle.gearbox.gear - 1);
    this.events.push({ type: 'hit', racer: s.to, from: s.from, zone: s.zone, pf, x: tgt.vehicle.curr.x, z: tgt.vehicle.curr.z });
  }

  /** A vent cloud near the segment widens the cone of whoever shoots through it. */
  cloudBetween(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    for (const c of this.clouds) {
      const u = Math.max(0, Math.min(1, ((c.x - ax) * dx + (c.z - az) * dz) / l2));
      const px = ax + dx * u - c.x;
      const pz = az + dz * u - c.z;
      if (px * px + pz * pz < CLOUD_RADIUS * CLOUD_RADIUS) return true;
    }
    return false;
  }

  /** Ramming test for every pair of vehicles in contact this step (gameplay.md §6.2). */
  private detectRams(clock: number): void {
    const t = (k: string) => tunables.get<number>(k);
    const n = this.racers.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = this.racers[i]!;
        const b = this.racers[j]!;
        const dx = b.vehicle.curr.x - a.vehicle.curr.x;
        const dz = b.vehicle.curr.z - a.vehicle.curr.z;
        const d = Math.hypot(dx, dz);
        if (d > 9 || d < 1e-3 || this.pairCooldown[i * n + j]! > 0) continue;
        let touching = false;
        this.world.contactPair(a.vehicle.collider, b.vehicle.collider, (m) => {
          if (m.numContacts() > 0) touching = true;
        });
        if (!touching) continue;
        const nx = dx / d;
        const nz = dz / d;
        const closing = (a.preVx - b.preVx) * nx + (a.preVz - b.preVz) * nz;
        if (closing < t('hull.ramMinSpeed')) continue;
        this.pairCooldown[i * n + j] = t('hull.ramCooldown');
        const ha = a.vehicle.heading();
        const hb = b.vehicle.heading();
        const cosNose = t('hull.ramNoseCos');
        const noseA = Math.sin(ha) * nx + Math.cos(ha) * nz > cosNose;
        const noseB = -(Math.sin(hb) * nx + Math.cos(hb) * nz) > cosNose;
        const perpendicular = Math.abs(Math.cos(ha - hb)) < 0.5;
        const res = ram(
          { mass: a.rules.stats.mass, gear: a.vehicle.gearbox.gear, nose: noseA },
          { mass: b.rules.stats.mass, gear: b.vehicle.gearbox.gear, nose: noseB },
          perpendicular,
          closing,
          this.rng,
        );
        if (res.a > 0) this.hurt(a, res.a, 'ram', clock);
        if (res.b > 0) this.hurt(b, res.b, 'ram', clock);
        if (res.winner !== 0) {
          const loser = res.winner > 0 ? b : a;
          loser.rules.hull.rammedFor = 1.5;
          if (res.margin >= 3) {
            // A strong win shoves the loser away from the winner.
            const s = (res.winner > 0 ? 1 : -1) * t('hull.ramShove');
            const lv = loser.vehicle.body.linvel();
            loser.vehicle.body.setLinvel({ x: lv.x + nx * s, y: lv.y, z: lv.z + nz * s }, true);
          }
        }
        this.events.push({ type: 'ram', a: i, b: j, winner: res.winner, x: a.vehicle.curr.x + dx / 2, z: a.vehicle.curr.z + dz / 2 });
      }
    }
  }
}

