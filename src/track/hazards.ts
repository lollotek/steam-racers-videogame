/**
 * Hazard zones (doc 04 §3 A4, §6): one generic, deterministic system with a timed cycle
 * (idle → warning → active) and per-phase effects. Pure: no Three.js, no Rapier.
 * The kinds are only presets (and visual skins); a track file may override any value.
 */
import type { HazardEffect, HazardKind, HazardPhase, HazardSpec } from './track-format';

export interface HazardPreset {
  length: number;
  lanes: [number, number];
  period: number;
  warning: number;
  active: number;
  effects: Partial<Record<HazardPhase, HazardEffect>>;
}

/** Lengths are whole squares (2.5 m) and lanes follow column boundaries (multiples of 1/3), units.ts. */
export const HAZARD_PRESETS: Record<HazardKind, HazardPreset> = {
  // Dwarven forge vents: a grate across the road over a magma channel; fire jets.
  vent: { length: 5, lanes: [-1, 1], period: 11, warning: 1.5, active: 1.5, effects: { active: { damage: 1, steam: 1 } } },
  // Victorian level crossing: barriers drop (slow), then the train (crash, heavy damage).
  crossing: { length: 10, lanes: [-1, 1], period: 25, warning: 3, active: 4, effects: { warning: { slow: 0.6 }, active: { crash: true, damage: 3 } } },
  // Orc magnet crane: a scrap block drops on part of the road and stays there as a wall.
  crane: { length: 7.5, lanes: [-1, 0], period: 14, warning: 2, active: 6, effects: { active: { damage: 4, solid: true } } },
  // Elven sap streams: lit lanes give steam on the pulse, are slippery between pulses.
  stream: { length: 30, lanes: [-1 / 3, 1 / 3], period: 6, warning: 0, active: 2.5, effects: { active: { steamRate: 1.5 }, idle: { grip: 0.75 } } },
};

/** A hazard placed on the compiled track. */
export interface CompiledHazard {
  id: number;
  kind: HazardKind;
  /** Range along the lap (s0 < s1, s1 may exceed the lap length when the zone wraps). */
  s0: number;
  s1: number;
  /** Lateral range in metres from the centre line (+ = right). */
  lat0: number;
  lat1: number;
  period: number;
  warning: number;
  active: number;
  phase: number;
  effects: Partial<Record<HazardPhase, HazardEffect>>;
  /** Centre pose (for visuals and solid colliders). */
  x: number;
  y: number;
  z: number;
  /** Heading of the track at the centre. */
  heading: number;
  length: number;
  /** Lateral centre and width (m). */
  latC: number;
  width: number;
}

export function resolveHazard(spec: HazardSpec): HazardPreset & { phase: number } {
  const p = HAZARD_PRESETS[spec.kind];
  return {
    length: spec.length ?? p.length,
    lanes: spec.lanes ?? p.lanes,
    period: spec.period ?? p.period,
    warning: spec.warning ?? p.warning,
    active: spec.active ?? p.active,
    phase: spec.phase ?? 0,
    effects: { ...p.effects, ...spec.effects },
  };
}

export interface HazardClock {
  phase: HazardPhase;
  /** Seconds into the current phase and its length. */
  t: number;
  duration: number;
  /** Seconds until the next active phase starts (0 while active). */
  untilActive: number;
}

/** Phase of a hazard at race time `clock` (deterministic; works before GO). */
export function hazardClock(h: Pick<CompiledHazard, 'period' | 'warning' | 'active' | 'phase'>, clock: number): HazardClock {
  const period = Math.max(0.1, h.period);
  const t = (((clock + h.phase) % period) + period) % period;
  const idle = Math.max(0, period - h.warning - h.active);
  if (t < idle) return { phase: 'idle', t, duration: idle, untilActive: idle - t + h.warning };
  if (t < idle + h.warning) return { phase: 'warning', t: t - idle, duration: h.warning, untilActive: idle + h.warning - t };
  return { phase: 'active', t: t - idle - h.warning, duration: h.active, untilActive: 0 };
}

/** Is the lap distance `s` inside the zone range (wrap aware)? */
export function inRange(h: Pick<CompiledHazard, 's0' | 's1'>, s: number, length: number, margin = 0): boolean {
  for (const k of [-length, 0, length]) {
    const d = s + k;
    if (d >= h.s0 - margin && d <= h.s1 + margin) return true;
  }
  return false;
}

/** Distance ahead (along the lap) from `s` to the zone start; 0 when inside. */
export function distanceTo(h: Pick<CompiledHazard, 's0' | 's1'>, s: number, length: number): number {
  if (inRange(h, s, length)) return 0;
  return (((h.s0 - s) % length) + length) % length;
}

/** Threat = an effect that hurts (used by the AI and the warning visuals). */
export function isThreat(e: HazardEffect | undefined): boolean {
  return !!e && (!!e.damage || !!e.crash || !!e.solid);
}
