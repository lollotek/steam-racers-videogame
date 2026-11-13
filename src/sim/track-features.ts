/**
 * Track features in the race simulation (doc 04 §3): pickups (A3), hazard zones (A4) and jump
 * landings (A5). Runs inside RaceSim's fixed step after progress, deterministic; writes rule
 * events into RaceRules.events. No rendering.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import { tunables } from '../core/tunables';
import { addPv } from '../rules/boiler';
import type { CompiledTrack } from '../track/compile';
import { type CompiledHazard, hazardClock, inRange } from '../track/hazards';
import type { HazardEffect, HazardPhase } from '../track/track-format';
import { WALL_GROUPS } from '../vehicles/vehicle-physics';
import type { RaceRules, RulesRacer } from './race-rules';

tunables.registerGroup('pickups', [
  { key: 'pickups.radius', type: 'number', default: 2.8, min: 0.5, max: 8, step: 0.1, unit: 'm', label: 'Collect radius' },
  { key: 'pickups.respawn', type: 'number', default: 8, min: 0, max: 60, step: 0.5, unit: 's', label: 'Respawn after' },
  { key: 'pickups.coalPv', type: 'number', default: 2, min: 0, max: 10, step: 1, unit: 'PV', label: 'Coal crate: PV' },
  { key: 'pickups.moneyValue', type: 'number', default: 5000, min: 0, max: 50000, step: 500, unit: '$', label: 'Money bag: $' },
]);

tunables.registerGroup('jumps', [
  { key: 'jumps.minAir', type: 'number', default: 0.35, min: 0.05, max: 2, step: 0.05, unit: 's', label: 'Landing counts after airtime' },
  { key: 'jumps.cleanTilt', type: 'number', default: 0.93, min: 0.5, max: 1, step: 0.01, label: 'Clean landing: min up·normal' },
  { key: 'jumps.hardSpeed', type: 'number', default: 10, min: 2, max: 30, step: 0.5, unit: 'm/s', label: 'Hard landing: vertical speed' },
  { key: 'jumps.cleanPv', type: 'number', default: 1, min: 0, max: 5, step: 1, unit: 'PV', label: 'Clean landing: PV' },
]);

tunables.registerGroup('hazards', [
  { key: 'hazards.enabled', type: 'boolean', default: true, label: 'Hazards on' },
  { key: 'hazards.crashStun', type: 'number', default: 1.2, min: 0, max: 5, step: 0.1, unit: 's', label: 'Hazard crash: stop time' },
  { key: 'hazards.margin', type: 'number', default: 1.2, min: 0, max: 4, step: 0.1, unit: 'm', label: 'Zone margin (vehicle half size)' },
]);

/** The parts of a racer this layer needs (RaceSim's Racer satisfies it). */
export interface FeatureRacer extends RulesRacer {
  progress: { s: number; lateral: number; index: number; lap: number };
  preVy: number;
}

export interface PickupState {
  active: boolean;
  /** Race time at which a taken crate comes back. */
  respawnAt: number;
}

interface RacerFeatureState {
  air: number;
  /** Per hazard: cycle index × phase already applied (one-shot effects). */
  applied: Map<number, string>;
  steamAcc: number;
}

export class TrackFeatures {
  readonly pickups: PickupState[];
  /** Current phase of each hazard (read by the game for visuals). */
  readonly phases: HazardPhase[];
  private readonly state: RacerFeatureState[];
  private readonly solids: (RAPIER.Collider | null)[];

  constructor(
    private readonly track: CompiledTrack,
    private readonly racers: FeatureRacer[],
    private readonly rules: RaceRules,
    rapier: typeof RAPIER,
    world: RAPIER.World,
  ) {
    this.pickups = track.pickups.map(() => ({ active: true, respawnAt: 0 }));
    this.phases = track.hazards.map(() => 'idle');
    this.state = racers.map(() => ({ air: 0, applied: new Map(), steamAcc: 0 }));
    // Solid hazards (crane block): a wall collider switched on while the effect says so.
    this.solids = track.hazards.map((h) => {
      if (!Object.values(h.effects).some((e) => e?.solid)) return null;
      const body = world.createRigidBody(rapier.RigidBodyDesc.fixed());
      const desc = rapier.ColliderDesc.cuboid(h.width / 2, 2.5, h.length / 2)
        .setTranslation(h.x, h.y + 2.5, h.z)
        .setRotation({ x: 0, y: Math.sin(h.heading / 2), z: 0, w: Math.cos(h.heading / 2) })
        .setCollisionGroups(WALL_GROUPS)
        .setFriction(0.2);
      const col = world.createCollider(desc, body);
      col.setEnabled(false);
      return col;
    });
  }

  /** After physics and progress. */
  step(dt: number, clock: number, running: boolean): void {
    const enabled = tunables.get<boolean>('hazards.enabled');
    for (const r of this.racers) {
      r.vehicle.gripMul = 1;
      r.vehicle.hazardSlow = 1;
    }
    this.track.hazards.forEach((h, i) => {
      const clk = hazardClock(h, clock);
      this.phases[i] = enabled ? clk.phase : 'idle';
      const solid = enabled && !!h.effects[clk.phase]?.solid;
      const col = this.solids[i];
      if (col && col.isEnabled() !== solid) col.setEnabled(solid);
      if (!enabled || !running) return;
      const effect = h.effects[clk.phase];
      if (!effect) return;
      const cycle = Math.floor((clock + h.phase) / Math.max(0.1, h.period));
      for (const r of this.racers) if (this.inside(h, r)) this.apply(h, effect, `${cycle}:${clk.phase}`, r, dt, clock);
    });
    if (running) {
      this.collect(clock);
      for (const r of this.racers) this.landing(r, dt);
    }
  }

  private inside(h: CompiledHazard, r: FeatureRacer): boolean {
    if (r.vehicle.wrecked || r.finished) return false;
    const m = tunables.get<number>('hazards.margin');
    const lat = r.progress.lateral;
    return lat >= h.lat0 - m && lat <= h.lat1 + m && inRange(h, r.progress.s, this.track.length, m);
  }

  private apply(h: CompiledHazard, e: HazardEffect, key: string, r: FeatureRacer, dt: number, clock: number): void {
    const v = r.vehicle;
    const st = this.state[r.index]!;
    if (e.grip !== undefined) v.gripMul = Math.min(v.gripMul, e.grip);
    if (e.slow !== undefined) v.hazardSlow = Math.min(v.hazardSlow, e.slow);
    if (e.steamRate) {
      st.steamAcc += e.steamRate * dt;
      if (st.steamAcc >= 1) {
        st.steamAcc -= 1;
        addPv(r.rules.boiler, 1);
        this.rules.events.push({ type: 'hazard', racer: r.index, id: h.id, kind: h.kind, effect: 'steam', amount: 1 });
      }
    }
    // One-shot effects: once per cycle and phase.
    if (st.applied.get(h.id) === key) return;
    if (!e.damage && !e.crash && !e.steam) return;
    st.applied.set(h.id, key);
    if (e.crash) {
      v.crash(tunables.get<number>('hazards.crashStun'));
      const lv = v.body.linvel();
      v.body.setLinvel({ x: lv.x * 0.1, y: lv.y, z: lv.z * 0.1 }, true);
      this.rules.events.push({ type: 'hazard', racer: r.index, id: h.id, kind: h.kind, effect: 'crash', amount: 0 });
    }
    if (e.damage) {
      const pf = this.rules.hurt(r, e.damage, 'hazard', clock);
      this.rules.events.push({ type: 'hazard', racer: r.index, id: h.id, kind: h.kind, effect: 'damage', amount: pf });
    }
    if (e.steam) {
      addPv(r.rules.boiler, e.steam);
      this.rules.events.push({ type: 'hazard', racer: r.index, id: h.id, kind: h.kind, effect: 'steam', amount: e.steam });
    }
  }

  private collect(clock: number): void {
    const rad = tunables.get<number>('pickups.radius');
    this.track.pickups.forEach((p, i) => {
      const st = this.pickups[i]!;
      if (!st.active) {
        if (clock >= st.respawnAt) st.active = true;
        else return;
      }
      for (const r of this.racers) {
        if (r.vehicle.wrecked || r.finished) continue;
        const c = r.vehicle.curr;
        if ((c.x - p.x) ** 2 + (c.z - p.z) ** 2 > rad * rad || Math.abs(c.y - p.y) > 4) continue;
        st.active = false;
        st.respawnAt = clock + tunables.get<number>('pickups.respawn');
        let amount = 0;
        if (p.kind === 'coal') {
          amount = tunables.get<number>('pickups.coalPv');
          addPv(r.rules.boiler, amount);
        } else {
          amount = tunables.get<number>('pickups.moneyValue');
          r.rules.money += amount;
        }
        this.rules.events.push({ type: 'pickup', racer: r.index, id: p.id, kind: p.kind, amount, x: p.x, y: p.y, z: p.z });
        break;
      }
    });
  }

  /** Jump landings (gameplay.md §5.1): clean = +PV, hard = −1 gear. */
  private landing(r: FeatureRacer, dt: number): void {
    const st = this.state[r.index]!;
    const v = r.vehicle;
    if (v.telemetry.wheelsOnGround === 0) {
      st.air += dt;
      return;
    }
    if (st.air >= tunables.get<number>('jumps.minAir') && v.telemetry.wheelsOnGround >= 2 && !v.wrecked) {
      const q = v.body.rotation();
      const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
      const hard = -r.preVy > tunables.get<number>('jumps.hardSpeed') || uy < tunables.get<number>('jumps.cleanTilt') - 0.15;
      const clean = !hard && uy >= tunables.get<number>('jumps.cleanTilt');
      let pv = 0;
      if (clean) {
        pv = tunables.get<number>('jumps.cleanPv');
        addPv(r.rules.boiler, pv);
      } else if (hard) v.gearbox.gear = Math.max(1, v.gearbox.gear - 1);
      this.rules.events.push({ type: 'landing', racer: r.index, clean, air: st.air, pv });
    }
    st.air = 0;
  }
}
