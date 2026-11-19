/**
 * Race intro shot list (the "fly-over" before the countdown): pure data + math, no Three.js, so it
 * runs in Node and is unit tested. The director (game/race-intro.ts) plays the shots on the cameras.
 *
 * Sequence:
 *   1. establish — high orbit over the whole track, track name + laps;
 *   2. points    — up to N fly-bys of key places (jumps, hazards, hairpins, chicanes…), in lap order;
 *   3. grid      — low tracking shot along the starting grid, back to front;
 *   4. hero      — swing around the player's vehicle; the director then hands over to the race camera.
 */
import type { Corner } from '../track/corners';
import type { HazardKind } from '../track/track-format';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type ShotKind = 'establish' | 'point' | 'grid' | 'hero';

export interface Shot {
  kind: ShotKind;
  duration: number;
  title: string;
  sub: string;
  /** Camera position, look-at point and vertical FOV (°) at normalised time u ∈ [0, 1]. */
  eye(u: number, out: Vec3): Vec3;
  look(u: number, out: Vec3): Vec3;
  fov(u: number): number;
}

/** What the planner needs of a compiled track (CompiledTrack fits). */
export interface IntroTrack {
  file: { name: string; laps: number };
  samples: { x: number; y: number; z: number; tx: number; tz: number }[];
  spacing: number;
  length: number;
  lineS: number;
  halfWidth: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number };
  hazards: { kind: HazardKind; s0: number; s1: number }[];
  jumps: { s0: number; gap0: number; gap1: number; minSpeed: number }[];
}

export interface IntroRacer {
  x: number;
  y: number;
  z: number;
  heading: number;
}

export interface IntroTimings {
  establish: number;
  point: number;
  points: number;
  grid: number;
  hero: number;
}

export const DEFAULT_TIMINGS: IntroTimings = { establish: 3.4, point: 2.2, points: 3, grid: 3.4, hero: 2.4 };

export interface IntroInput {
  track: IntroTrack;
  corners: Corner[];
  /** Every racer's pose on the grid (index = racer). */
  racers: IntroRacer[];
  /** Racer the hero shot frames (player 1). */
  hero: number;
  /** Grid slot of the hero (0 = pole), for the caption. */
  heroSlot: number;
  heroName: string;
  timings?: Partial<IntroTimings>;
}

/** A place worth showing, with its caption. */
export interface KeyPoint {
  s: number;
  /** Fly-by from `s - lead` to `s + trail`. */
  lead: number;
  trail: number;
  priority: number;
  title: string;
  sub: string;
  /** Preferred camera side (+1 right, −1 left of the driving direction). */
  side: 1 | -1;
}

const HAZARD_TEXT: Record<HazardKind, [string, string]> = {
  vent: ['FORGE VENTS', 'Steam bursts on a timer'],
  crossing: ['RAIL CROSSING', 'Mind the train'],
  crane: ['SCRAP CRANE', 'Falling scrap blocks'],
  stream: ['SAP STREAM', 'Slick and slow'],
};

const CORNER_TEXT: Record<Corner['kind'], [string, string, number]> = {
  hairpin: ['HAIRPIN', 'Gear down early', 2.6],
  s: ['CHICANE', 'Flick it left and right', 2.2],
  tight: ['TIGHT BEND', 'Brake before the turn-in', 1.6],
  wide: ['SWEEPER', 'Flat out if you dare', 1],
};

const DEG = Math.PI / 180;
const mod = (a: number, n: number) => ((a % n) + n) % n;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => {
  const u = Math.min(1, Math.max(0, t));
  return u * u * (3 - 2 * u);
};
/** Ease in-out (cubic): slower start and end than smoothstep, for the long camera moves. */
export const easeInOut = (t: number) => {
  const u = Math.min(1, Math.max(0, t));
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
};

/** Centre-line point and tangent at lap distance `s` (wraps), linearly interpolated. */
export function trackAt(track: IntroTrack, s: number): { x: number; y: number; z: number; tx: number; tz: number } {
  const n = track.samples.length;
  const f = mod(s, track.length) / track.spacing;
  const i = Math.floor(f) % n;
  const a = track.samples[i]!;
  const b = track.samples[(i + 1) % n]!;
  const t = f - Math.floor(f);
  const tx = lerp(a.tx, b.tx, t);
  const tz = lerp(a.tz, b.tz, t);
  const l = Math.hypot(tx, tz) || 1;
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t), tx: tx / l, tz: tz / l };
}

/** Every candidate key point of the track (jumps, hazards, corners), unsorted. */
export function keyPoints(track: IntroTrack, corners: Corner[]): KeyPoint[] {
  const out: KeyPoint[] = [];
  for (const j of track.jumps) {
    out.push({ s: (j.gap0 + j.gap1) / 2, lead: 50, trail: 12, priority: 3, title: 'THE JUMP', sub: `Hit the lip above ${Math.round(j.minSpeed * 3.6)} km/h`, side: 1 });
  }
  for (const h of track.hazards) {
    const [title, sub] = HAZARD_TEXT[h.kind];
    out.push({ s: (h.s0 + h.s1) / 2, lead: 40, trail: 10, priority: 2.8, title, sub, side: -1 });
  }
  for (const c of corners) {
    const [title, sub, priority] = CORNER_TEXT[c.kind];
    // Camera on the outside of the (first) bend: it sees the whole turn sweep past.
    out.push({ s: (c.s0 + c.s1) / 2, lead: 45, trail: 8, priority, title, sub, side: c.turn === 'L' ? 1 : -1 });
  }
  return out;
}

/**
 * Pick up to `max` key points: best priority first, spread around the lap (no two closer than a
 * sixth of the lap, none on the start straight shown by the grid shot), then sorted in lap order.
 */
export function pickKeyPoints(track: IntroTrack, corners: Corner[], max: number): KeyPoint[] {
  const L = track.length;
  const gap = L / 6;
  const ahead = (s: number) => mod(s - track.lineS, L);
  const dist = (a: number, b: number) => {
    const d = mod(a - b, L);
    return Math.min(d, L - d);
  };
  const all = keyPoints(track, corners).sort((a, b) => b.priority - a.priority || ahead(a.s) - ahead(b.s));
  const picked: KeyPoint[] = [];
  // First pass: one of each kind (variety); second pass: repeats allowed to fill the list.
  for (const unique of [true, false]) {
    for (const p of all) {
      if (picked.length >= max) break;
      if (picked.includes(p) || ahead(p.s) < 40 || ahead(p.s) > L - 30) continue;
      if (unique && picked.some((q) => q.title === p.title)) continue;
      if (picked.some((q) => dist(p.s, q.s) < gap)) continue;
      picked.push(p);
    }
  }
  return picked.sort((a, b) => ahead(a.s) - ahead(b.s));
}

/** The whole shot list for a race. */
export function planIntro(input: IntroInput): Shot[] {
  const tm = { ...DEFAULT_TIMINGS, ...input.timings };
  const { track } = input;
  const shots: Shot[] = [establishShot(track, tm.establish)];
  for (const p of pickKeyPoints(track, input.corners, Math.max(0, Math.round(tm.points)))) shots.push(pointShot(track, p, tm.point));
  if (input.racers.length > 0) {
    shots.push(gridShot(track, input.racers, tm.grid));
    const hero = input.racers[input.hero] ?? input.racers[0]!;
    shots.push(heroShot(hero, input.heroName, input.heroSlot, tm.hero));
  }
  return shots.filter((s) => s.duration > 0);
}

/** Orbit high above the track centre, pushing in slightly; the whole track fits the frame. */
function establishShot(track: IntroTrack, duration: number): Shot {
  const b = track.bounds;
  const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, z: (b.minZ + b.maxZ) / 2 };
  const radius = Math.max(60, Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2);
  const fov = 34;
  const base = Math.min(780, (radius / Math.tan((fov / 2) * DEG)) * 0.95);
  const pitch = 58 * DEG;
  const a0 = 20 * DEG;
  const sweep = 32 * DEG;
  const laps = track.file.laps;
  return {
    kind: 'establish',
    duration,
    title: track.file.name.toUpperCase(),
    sub: `${laps} ${laps === 1 ? 'LAP' : 'LAPS'}`,
    eye(u, out) {
      const a = a0 + sweep * u;
      const d = base * lerp(1.12, 0.98, easeInOut(u));
      out.x = c.x + Math.sin(a) * Math.cos(pitch) * d;
      out.y = c.y + Math.sin(pitch) * d;
      out.z = c.z + Math.cos(a) * Math.cos(pitch) * d;
      return out;
    },
    look(_u, out) {
      out.x = c.x;
      out.y = c.y;
      out.z = c.z;
      return out;
    },
    fov: () => fov,
  };
}

/** Crane fly-by along the road past a key point: starts high and behind, settles low beside it. */
function pointShot(track: IntroTrack, p: KeyPoint, duration: number): Shot {
  const off = 22;
  const at = trackAt(track, p.s);
  const exit = trackAt(track, p.s + 30);
  return {
    kind: 'point',
    duration,
    title: p.title,
    sub: p.sub,
    eye(u, out) {
      const e = smooth(u);
      const q = trackAt(track, p.s - p.lead + (p.lead + p.trail) * e);
      // Right of the driving direction: (−tz, tx) on the ground plane.
      out.x = q.x - q.tz * off * p.side;
      out.y = q.y + lerp(40, 18, e);
      out.z = q.z + q.tx * off * p.side;
      return out;
    },
    look(u, out) {
      const k = smooth(u) * 0.35;
      out.x = lerp(at.x, exit.x, k);
      out.y = lerp(at.y, exit.y, k) + 1.5;
      out.z = lerp(at.z, exit.z, k);
      return out;
    },
    fov: (u) => lerp(50, 42, u),
  };
}

/** Low tracking shot down the side of the grid, from the back row to beyond pole. */
function gridShot(track: IntroTrack, racers: IntroRacer[], duration: number): Shot {
  const line = trackAt(track, track.lineS);
  const fx = line.tx;
  const fz = line.tz;
  const rx = -fz;
  const rz = fx;
  let back = Infinity;
  let front = -Infinity;
  let lat = 0;
  let y = 0;
  const o = racers[0]!;
  for (const r of racers) {
    const along = (r.x - o.x) * fx + (r.z - o.z) * fz;
    back = Math.min(back, along);
    front = Math.max(front, along);
    lat += (r.x - o.x) * rx + (r.z - o.z) * rz;
    y += r.y;
  }
  lat /= racers.length;
  y /= racers.length;
  const at = (along: number, side: number, h: number, out: Vec3) => {
    out.x = o.x + fx * along + rx * (lat + side);
    out.y = y + h;
    out.z = o.z + fz * along + rz * (lat + side);
    return out;
  };
  const n = racers.length;
  // Over the road (roadside dressing would block a camera beside it), a little to one side.
  const side = Math.min(track.halfWidth * 0.5, 5);
  return {
    kind: 'grid',
    duration,
    title: 'STARTING GRID',
    sub: `${n} RACERS`,
    eye(u, out) {
      const e = easeInOut(u);
      return at(lerp(back - 22, front - 4, e), side, lerp(13, 8, e), out);
    },
    look(u, out) {
      const e = easeInOut(u);
      return at(lerp(back + 2, front + 12, e), 0, 0.8, out);
    },
    fov: (u) => lerp(42, 36, u),
  };
}

/** Swing from in front of the hero's vehicle round to behind it, rising. */
function heroShot(hero: IntroRacer, name: string, slot: number, duration: number): Shot {
  const fx = Math.sin(hero.heading);
  const fz = Math.cos(hero.heading);
  const rx = -fz;
  const rz = fx;
  return {
    kind: 'hero',
    duration,
    title: name.toUpperCase(),
    sub: `STARTS P${slot + 1}`,
    eye(u, out) {
      const e = easeInOut(u);
      // Angle from the nose: 25° (front, a little to the right) → 150° (behind-right).
      const a = lerp(25, 150, e) * DEG;
      const r = lerp(8, 12, e);
      out.x = hero.x + (fx * Math.cos(a) + rx * Math.sin(a)) * r;
      out.y = hero.y + lerp(1.6, 5, e);
      out.z = hero.z + (fz * Math.cos(a) + rz * Math.sin(a)) * r;
      return out;
    },
    look(u, out) {
      const k = smooth(u) * 4;
      out.x = hero.x + fx * k;
      out.y = hero.y + 1;
      out.z = hero.z + fz * k;
      return out;
    },
    fov: (u) => lerp(38, 44, u),
  };
}
