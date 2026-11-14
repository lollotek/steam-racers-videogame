/**
 * Track compiler: block chain → runtime track data (doc 03 §7.1, v2 in doc 04 §3 A2/A5).
 * Coordinates: X/Z ground plane, Y up; heading 0 = +Z, the driver's right of heading h is (-cos h, sin h)
 * (consistent with the camera: steering right turns the view right).
 * Distances along the line (s) are measured on the ground plane; heights (y) follow the levels.
 */
import {
  type Barricade,
  type Piece,
  type PickupKind,
  type Surface,
  type TrackFile,
  HAZARD_KINDS,
  JUMP,
  MAX_CREST,
  MAX_GRADE,
  PICKUP_KINDS,
  SURFACES,
  asArray,
} from './track-format';
import { type CompiledHazard, resolveHazard } from './hazards';
import { tunables } from '../core/tunables';
import { LANE_REACH } from './units';

tunables.registerGroup('race', [
  { key: 'race.gridFirst', type: 'number', default: 6.25, min: 2, max: 30, step: 0.25, unit: 'm', label: 'Grid: pole behind the line' },
  { key: 'race.gridRowGap', type: 'number', default: 12.5, min: 6, max: 30, step: 0.5, unit: 'm', label: 'Grid: distance between rows' },
  { key: 'race.gridStagger', type: 'number', default: 7.5, min: 0, max: 15, step: 0.5, unit: 'm', label: 'Grid: left column offset back' },
  { key: 'race.gridLateral', type: 'number', default: 0.5, min: 0.2, max: 0.7, step: 0.01, label: 'Grid: columns from centre (× half width)' },
]);

/** What the road does at a sample: plain road, or part of a jump. */
export type Feature = 'road' | 'kicker' | 'gap' | 'landing';

export interface TrackSample {
  x: number;
  /** Road height (m). In a jump gap: the straight line from lip to landing (camera, progress). */
  y: number;
  z: number;
  /** Unit tangent on the ground plane. */
  tx: number;
  tz: number;
  /** dy/ds. */
  grade: number;
  /** Distance from the start line along the centre line. */
  s: number;
  surface: Surface;
  left: Barricade;
  right: Barricade;
  /** Signed curvature (1/m), + = turning right. */
  curvature: number;
  piece: number;
  feature: Feature;
}

export interface SpawnSlot {
  x: number;
  y: number;
  z: number;
  heading: number;
}

export interface CompiledPickup {
  id: number;
  kind: PickupKind;
  s: number;
  /** Lateral offset (m, + = right). */
  lateral: number;
  x: number;
  y: number;
  z: number;
}

export interface CompiledLandmark {
  id: string;
  x: number;
  y: number;
  z: number;
  r: number;
  /** Heading facing the track. */
  facing: number;
  piece: number;
}

export interface CompiledJump {
  piece: number;
  /** Kicker start, gap start/end, landing end (lap distances). */
  s0: number;
  gap0: number;
  gap1: number;
  s1: number;
  /** Speed needed at the lip to clear the gap (m/s, with margin). */
  minSpeed: number;
}

export interface CompiledTrack {
  file: TrackFile;
  samples: TrackSample[];
  /** Sample spacing in metres. */
  spacing: number;
  length: number;
  halfWidth: number;
  /** Distances (s) of checkpoints (piece boundaries); used to validate laps. */
  checkpoints: number[];
  /** Distance of the start/finish line (near the end of the start piece, the grid is behind it). */
  lineS: number;
  spawn: SpawnSlot[];
  /** Occupied grid cells "cx,cz" (for validation and the future editor). */
  cells: Set<string>;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number };
  pickups: CompiledPickup[];
  hazards: CompiledHazard[];
  landmarks: CompiledLandmark[];
  jumps: CompiledJump[];
}

export class TrackError extends Error {}

interface Cursor {
  x: number;
  z: number;
  h: number; // heading radians, multiple of π/2
  level: number;
}

const fwd = (h: number) => ({ x: Math.sin(h), z: Math.cos(h) });
const right = (h: number) => ({ x: -Math.cos(h), z: Math.sin(h) });
const snap = (v: number) => Math.round(v * 1e6) / 1e6;
const normAngle = (a: number) => {
  let r = a % (Math.PI * 2);
  if (r < 0) r += Math.PI * 2;
  return r;
};
const smooth = (u: number) => u * u * (3 - 2 * u);

/** Cells covered by a piece starting at cursor c (cell units, entry at edge midpoint). */
function pieceCells(c: Cursor, p: Piece, cell: number): string[] {
  const out: string[] = [];
  const f = fwd(c.h);
  const r = right(c.h);
  const n = p.size ?? 1;
  // Centre of the first cell = entry + half a cell forward.
  const base = { x: c.x + f.x * cell * 0.5, z: c.z + f.z * cell * 0.5 };
  const key = (x: number, z: number) => `${Math.round(x / cell - 0.5)},${Math.round(z / cell - 0.5)}`;
  if (p.type === 'curve') {
    const sgn = p.turn === 'L' ? -1 : 1;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) out.push(key(base.x + f.x * cell * i + r.x * cell * j * sgn, base.z + f.z * cell * i + r.z * cell * j * sgn));
  } else {
    for (let i = 0; i < n; i++) out.push(key(base.x + f.x * cell * i, base.z + f.z * cell * i));
  }
  return out;
}

/** Height profile of a piece: y(d) for d in [0, len], relative to the entry level height. */
function heightProfile(p: Piece, len: number, levelH: number, idx: number): { y: (d: number) => number; feature: (d: number) => Feature } {
  const rise = (p.rise ?? 0) * levelH;
  if (p.type === 'jump') {
    const gap = len - JUMP.kicker - JUMP.landing;
    if (gap < JUMP.minGap) throw new TrackError(`Piece ${idx}: jump too short (gap ${gap.toFixed(1)} m < ${JUMP.minGap} m); use size ≥ 2`);
    return {
      y: (d) => {
        if (d <= JUMP.kicker) return JUMP.lip * (d / JUMP.kicker) ** 2;
        const l0 = len - JUMP.landing;
        if (d >= l0) return rise + JUMP.land * (1 - (d - l0) / JUMP.landing) ** 2;
        // Gap: straight line from the lip to the top of the landing (camera, progress only).
        const u = (d - JUMP.kicker) / gap;
        return JUMP.lip + (rise + JUMP.land - JUMP.lip) * u;
      },
      feature: (d) => (d < JUMP.kicker ? 'kicker' : d <= len - JUMP.landing ? (d > JUMP.kicker ? 'gap' : 'kicker') : 'landing'),
    };
  }
  const crest = p.crest ?? 0;
  return {
    y: (d) => {
      const u = Math.min(1, Math.max(0, d / len));
      return rise * smooth(u) + crest * Math.sin(Math.PI * u) ** 2;
    },
    feature: () => 'road',
  };
}

export function compileTrack(file: TrackFile, spacing = 1): CompiledTrack {
  if (!file.pieces.length) throw new TrackError('Track has no pieces');
  if (file.pieces[0]!.type !== 'start') throw new TrackError('First piece must be "start"');
  if (file.pieces.filter((p) => p.type === 'start').length !== 1) throw new TrackError('Exactly one "start" piece is required');

  const cell = file.cell;
  const levelH = file.level ?? 4;
  // Grid origin: start entry at (cell/2, 0) so cells are aligned to multiples of `cell`.
  const c: Cursor = { x: cell / 2, z: 0, h: 0, level: 0 };
  const raw: Omit<TrackSample, 's' | 'grade'>[] = [];
  const cells = new Set<string>();
  const checkpoints: number[] = [];
  /** First raw sample index and nominal length of each piece. */
  const pieceStart: number[] = [];
  const pieceLen: number[] = [];
  let length = 0;

  file.pieces.forEach((p, idx) => {
    for (const k of pieceCells(c, p, cell)) {
      if (cells.has(k)) throw new TrackError(`Piece ${idx} (${p.type}) overlaps cell ${k}`);
      cells.add(k);
    }
    if (p.surface && !SURFACES.includes(p.surface)) throw new TrackError(`Piece ${idx}: unknown surface "${p.surface}"`);
    if (p.type === 'start' && (p.rise || p.crest)) throw new TrackError('The start piece must be level');
    if (p.crest && (p.type !== 'straight' || Math.abs(p.crest) > MAX_CREST)) throw new TrackError(`Piece ${idx}: crest only on straights, at most ${MAX_CREST} m`);
    if (p.rise !== undefined && !Number.isInteger(p.rise)) throw new TrackError(`Piece ${idx}: rise must be a whole number of levels`);
    const surface = p.surface ?? file.defaultSurface;
    const left = p.left ?? file.defaultBarricade;
    const rightB = p.right ?? file.defaultBarricade;
    const base = { surface, left, right: rightB, piece: idx };
    checkpoints.push(length);
    pieceStart.push(raw.length);
    const y0 = c.level * levelH;

    if (p.type === 'curve') {
      if (p.turn !== 'L' && p.turn !== 'R') throw new TrackError(`Piece ${idx}: curve needs turn "L" or "R"`);
      const n = p.size ?? 1;
      const radius = (n - 0.5) * cell;
      const sgn = p.turn === 'R' ? 1 : -1;
      const r = right(c.h);
      // Arc centre on the inside of the turn.
      const cx = c.x + r.x * radius * sgn;
      const cz = c.z + r.z * radius * sgn;
      const arc = (Math.PI / 2) * radius;
      const prof = heightProfile(p, arc, levelH, idx);
      const steps = Math.max(2, Math.round(arc / spacing));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * (Math.PI / 2);
        const h = c.h - sgn * a; // right turn decreases heading
        // Position: rotate the start offset (start - centre) around the centre by -sgn·a about Y.
        const ox = c.x - cx;
        const oz = c.z - cz;
        const ang = -sgn * a;
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        const x = cx + ox * cos + oz * sin;
        const z = cz - ox * sin + oz * cos;
        const t = fwd(h);
        const d = (i / steps) * arc;
        raw.push({ x, y: y0 + prof.y(d), z, tx: t.x, tz: t.z, curvature: sgn / radius, feature: prof.feature(d), ...base });
      }
      length += arc;
      pieceLen.push(arc);
      const exitH = c.h - sgn * (Math.PI / 2);
      const f = fwd(c.h);
      c.x = snap(c.x + f.x * radius + r.x * radius * sgn);
      c.z = snap(c.z + f.z * radius + r.z * radius * sgn);
      c.h = normAngle(exitH);
    } else {
      const n = p.size ?? 1;
      const len = n * cell;
      const prof = heightProfile(p, len, levelH, idx);
      const f = fwd(c.h);
      const steps = Math.max(1, Math.round(len / spacing));
      for (let i = 0; i < steps; i++) {
        const d = (i / steps) * len;
        raw.push({ x: c.x + f.x * d, y: y0 + prof.y(d), z: c.z + f.z * d, tx: f.x, tz: f.z, curvature: 0, feature: prof.feature(d), ...base });
      }
      length += len;
      pieceLen.push(len);
      c.x = snap(c.x + f.x * len);
      c.z = snap(c.z + f.z * len);
    }
    c.level += p.rise ?? 0;
  });

  // Closure: back at the start entry, heading north, at level 0.
  if (Math.abs(c.x - cell / 2) > 1e-3 || Math.abs(c.z) > 1e-3 || Math.abs(normAngle(c.h)) > 1e-3 && Math.abs(normAngle(c.h) - Math.PI * 2) > 1e-3) {
    throw new TrackError(`Track is not closed: ends at (${c.x.toFixed(1)}, ${c.z.toFixed(1)}) heading ${((c.h * 180) / Math.PI).toFixed(0)}°`);
  }
  if (c.level !== 0) throw new TrackError(`Track is not closed in height: ends at level ${c.level} (the rises must sum to 0)`);

  // Distances along the line (re-measured from the samples for accuracy).
  const samples: TrackSample[] = [];
  let s = 0;
  raw.forEach((r, i) => {
    if (i > 0) s += Math.hypot(r.x - raw[i - 1]!.x, r.z - raw[i - 1]!.z);
    samples.push({ ...r, s, grade: 0 });
  });
  const realLength = s + Math.hypot(raw[0]!.x - raw[raw.length - 1]!.x, raw[0]!.z - raw[raw.length - 1]!.z);
  const nS = samples.length;
  // Grades (central differences) and the slope limit on the road.
  for (let i = 0; i < nS; i++) {
    const a = samples[(i - 1 + nS) % nS]!;
    const b = samples[(i + 1) % nS]!;
    const ds = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const smp = samples[i]!;
    smp.grade = (b.y - a.y) / ds;
    if (smp.feature === 'road' && Math.abs(smp.grade) > MAX_GRADE + 1e-6)
      throw new TrackError(`Piece ${smp.piece}: slope ${(Math.abs(smp.grade) * 100).toFixed(0)} % is too steep (max ${(MAX_GRADE * 100).toFixed(0)} %): make the piece longer`);
  }
  // Rescale checkpoint distances to the measured length.
  const scale = realLength / length;
  const cps = checkpoints.map((d) => d * scale);

  const halfWidth = file.width / 2;
  const startLen = (file.pieces[0]!.size ?? 1) * cell * scale;
  const lineS = Math.max(4, startLen - 4);
  const track0 = { samples, length: realLength } as CompiledTrack;
  // Spawn grid: 2 columns, staggered rows behind the line (spaced so the start is not a pile-up;
  // back rows follow the centre line into the previous pieces).
  const spawn: SpawnSlot[] = [];
  const g = (k: string) => tunables.get<number>(k);
  for (let i = 0; i < 8; i++) {
    const row = Math.floor(i / 2);
    const side = i % 2 === 0 ? 1 : -1; // pole on the right (driver's view)
    const sp = sampleAt(track0, lineS - g('race.gridFirst') - row * g('race.gridRowGap') - (side < 0 ? g('race.gridStagger') : 0));
    // Driver's right of the tangent heading.
    const h = Math.atan2(sp.tx, sp.tz);
    const r = right(h);
    const lat = halfWidth * g('race.gridLateral') * side;
    spawn.push({ x: sp.x + r.x * lat, y: sp.y, z: sp.z + r.z * lat, heading: h });
  }

  // Pickups, hazards, landmarks, jumps: placed from the piece they belong to.
  const pieceS = (idx: number, at: number) => cps[idx]! + Math.min(1, Math.max(0, at)) * pieceLen[idx]! * scale;
  const pickups: CompiledPickup[] = [];
  const hazards: CompiledHazard[] = [];
  const landmarks: CompiledLandmark[] = [];
  const jumps: CompiledJump[] = [];
  const reach = halfWidth * LANE_REACH;
  file.pieces.forEach((p, idx) => {
    for (const slot of p.pickups ?? []) {
      if (!PICKUP_KINDS.includes(slot.kind)) throw new TrackError(`Piece ${idx}: unknown pickup "${slot.kind}"`);
      const sAt = pieceS(idx, slot.at ?? 0.5);
      const sp = sampleAt(track0, sAt);
      if (sp.feature === 'gap') throw new TrackError(`Piece ${idx}: pickup in a jump gap`);
      const lateral = Math.max(-1, Math.min(1, slot.lane ?? 0)) * reach;
      pickups.push({ id: pickups.length, kind: slot.kind, s: sAt, lateral, x: sp.x - sp.tz * lateral, y: sp.y, z: sp.z + sp.tx * lateral });
    }
    for (const spec of asArray(p.hazard)) {
      if (!HAZARD_KINDS.includes(spec.kind)) throw new TrackError(`Piece ${idx}: unknown hazard "${spec.kind}"`);
      const h = resolveHazard(spec);
      const mid = pieceS(idx, spec.at ?? 0.5);
      const sp = sampleAt(track0, mid);
      const [a, b] = h.lanes;
      if (!(a >= -1 && b <= 1 && a < b)) throw new TrackError(`Piece ${idx}: hazard lanes must be -1 ≤ a < b ≤ 1`);
      const lat0 = a * halfWidth;
      const lat1 = b * halfWidth;
      const latC = (lat0 + lat1) / 2;
      hazards.push({
        id: hazards.length,
        kind: spec.kind,
        s0: mid - h.length / 2,
        s1: mid + h.length / 2,
        lat0,
        lat1,
        period: h.period,
        warning: h.warning,
        active: h.active,
        phase: h.phase,
        effects: h.effects,
        x: sp.x - sp.tz * latC,
        y: sp.y,
        z: sp.z + sp.tx * latC,
        heading: Math.atan2(sp.tx, sp.tz),
        length: h.length,
        latC,
        width: lat1 - lat0,
      });
    }
    for (const lm of asArray(p.landmark)) {
      const sp = sampleAt(track0, pieceS(idx, lm.at ?? 0.5));
      const side = lm.side === 'R' ? 1 : -1;
      const off = halfWidth + (lm.offset ?? 20);
      const x = sp.x - sp.tz * off * side;
      const z = sp.z + sp.tx * off * side;
      landmarks.push({ id: lm.id, x, y: sp.y, z, r: lm.radius ?? 15, facing: Math.atan2(sp.x - x, sp.z - z), piece: idx });
    }
    if (p.type === 'jump') {
      const s0 = cps[idx]!;
      const len = pieceLen[idx]! * scale;
      const gap0 = s0 + JUMP.kicker * scale;
      const gap1 = s0 + len - JUMP.landing * scale;
      // Ballistics from the lip to the top of the landing ramp (doc 04 A5), 20 % margin.
      const theta = Math.atan((2 * JUMP.lip) / JUMP.kicker);
      const G = gap1 - gap0;
      const drop = JUMP.lip - ((p.rise ?? 0) * levelH + JUMP.land);
      const den = 2 * Math.cos(theta) ** 2 * (G * Math.tan(theta) + drop);
      const v = den > 0 ? Math.sqrt((9.81 * G * G) / den) : 40;
      jumps.push({ piece: idx, s0, gap0, gap1, s1: s0 + len, minSpeed: v * 1.2 });
    }
  });

  const xs = samples.map((p) => p.x);
  const zs = samples.map((p) => p.z);
  const ys = samples.map((p) => p.y);
  return {
    file,
    samples,
    spacing,
    length: realLength,
    halfWidth,
    checkpoints: cps,
    lineS,
    spawn,
    cells,
    bounds: { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), minY: Math.min(...ys), maxY: Math.max(...ys) },
    pickups,
    hazards,
    landmarks,
    jumps,
  };
}

export interface TrackPoint {
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
  grade: number;
  curvature: number;
  surface: Surface;
  feature: Feature;
}

/** Sample at distance s (wraps), linear interpolation. */
export function sampleAt(track: Pick<CompiledTrack, 'samples' | 'length'>, s: number): TrackPoint {
  const L = track.length;
  const d = ((s % L) + L) % L;
  const n = track.samples.length;
  // Binary search on s.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track.samples[mid]!.s <= d) lo = mid;
    else hi = mid - 1;
  }
  const a = track.samples[lo]!;
  const b = track.samples[(lo + 1) % n]!;
  const segLen = (lo + 1 < n ? b.s : L) - a.s;
  const k = segLen > 0 ? (d - a.s) / segLen : 0;
  const tx = a.tx + (b.tx - a.tx) * k;
  const tz = a.tz + (b.tz - a.tz) * k;
  const tl = Math.hypot(tx, tz) || 1;
  return {
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    z: a.z + (b.z - a.z) * k,
    tx: tx / tl,
    tz: tz / tl,
    grade: a.grade,
    curvature: a.curvature,
    surface: a.surface,
    feature: a.feature,
  };
}

/** Road height near (x, z): the nearest centre-line sample (search hint optional). */
export function nearestIndex(track: Pick<CompiledTrack, 'samples' | 'halfWidth'>, x: number, z: number, hint = -1): number {
  const n = track.samples.length;
  const scan = (from: number, count: number) => {
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < count; k++) {
      const i = (((from + k) % n) + n) % n;
      const p = track.samples[i]!;
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { best, bestD };
  };
  if (hint >= 0) {
    const w = scan(hint - 25, 51);
    if (w.bestD < (track.halfWidth * 2.5) ** 2) return w.best;
  }
  return scan(0, n).best;
}
