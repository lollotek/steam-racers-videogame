/**
 * Corner classification for the pre-corner warning (doc 03 §13 HUD, corner tag).
 * Pure data + math: no Three.js, runs in Node, unit tested.
 *
 * Curve pieces are grouped into corners read off the piece chain:
 *   - consecutive curves turning the same way form one bend (90° per piece);
 *   - two bends turning opposite ways, joined directly or by a short straight, form an S (chicane).
 * Each bend is then:
 *   wide    — no tight piece (size ≥ 2);
 *   tight   — a size-1 piece, under 180°;
 *   hairpin — a size-1 piece, 180° or more.
 */
import type { Turn, TrackFile } from './track-format';
import { GEAR_RATIOS } from '../vehicles/gearbox';

export type BendKind = 'wide' | 'tight' | 'hairpin';
export type CornerKind = BendKind | 's';

/** One same-direction bend (a run of curve pieces). */
export interface Bend {
  kind: BendKind;
  turn: Turn;
  /** Lap distances of entry and exit. */
  s0: number;
  s1: number;
  /** Total turning angle (degrees). */
  angle: number;
  /** Tightest radius of the bend (m). */
  minRadius: number;
}

export interface Corner {
  kind: CornerKind;
  /** Direction of the first bend. */
  turn: Turn;
  s0: number;
  s1: number;
  /** 1 = wide, 2 = tight, 3 = hairpin (an S takes its worst bend). */
  severity: 1 | 2 | 3;
  /** Bends in order (one, or two+ for an S). */
  bends: Bend[];
  minRadius: number;
}

export interface CornerOptions {
  /** Longest straight that still joins two opposite bends into an S (m, default one grid cell). */
  sGap?: number;
}

const SEVERITY: Record<BendKind, 1 | 2 | 3> = { wide: 1, tight: 2, hairpin: 3 };

/** Radius of a curve piece of `size` cells, as built by the compiler. */
export const curveRadius = (size: number, cell: number) => (size - 0.5) * cell;

/**
 * @param track compiled track parts: the file, piece start distances (`checkpoints`) and lap length
 */
export function classifyCorners(track: { file: Pick<TrackFile, 'pieces' | 'cell'>; checkpoints: number[]; length: number }, opts: CornerOptions = {}): Corner[] {
  const { pieces, cell } = track.file;
  const sGap = opts.sGap ?? cell;
  const pieceEnd = (i: number) => (i + 1 < pieces.length ? track.checkpoints[i + 1]! : track.length);

  // 1. Bends: runs of consecutive curve pieces turning the same way.
  const bends: { bend: Bend; first: number; last: number }[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    if (p.type !== 'curve' || !p.turn) continue;
    const prev = bends[bends.length - 1];
    const r = curveRadius(p.size ?? 1, cell);
    if (prev && prev.last === i - 1 && prev.bend.turn === p.turn) {
      prev.last = i;
      prev.bend.s1 = pieceEnd(i);
      prev.bend.angle += 90;
      prev.bend.minRadius = Math.min(prev.bend.minRadius, r);
    } else {
      bends.push({ bend: { kind: 'wide', turn: p.turn, s0: track.checkpoints[i]!, s1: pieceEnd(i), angle: 90, minRadius: r }, first: i, last: i });
    }
  }
  const tightR = curveRadius(1, cell) + 1e-6;
  for (const { bend } of bends) bend.kind = bend.minRadius > tightR ? 'wide' : bend.angle >= 180 ? 'hairpin' : 'tight';

  // 2. Corners: opposite bends close together become an S.
  const corners: Corner[] = [];
  let prevLast = -1;
  for (const b of bends) {
    const prev = corners[corners.length - 1];
    const lastBend = prev?.bends[prev.bends.length - 1];
    const joinable = prev && lastBend && lastBend.turn !== b.bend.turn && b.bend.s0 - lastBend.s1 <= sGap + 1e-6 && onlyStraights(pieces, prevLast + 1, b.first);
    if (joinable) {
      prev.kind = 's';
      prev.bends.push(b.bend);
      prev.s1 = b.bend.s1;
      prev.severity = Math.max(prev.severity, SEVERITY[b.bend.kind]) as 1 | 2 | 3;
      prev.minRadius = Math.min(prev.minRadius, b.bend.minRadius);
    } else {
      corners.push({ kind: b.bend.kind, turn: b.bend.turn, s0: b.bend.s0, s1: b.bend.s1, severity: SEVERITY[b.bend.kind], bends: [b.bend], minRadius: b.bend.minRadius });
    }
    prevLast = b.last;
  }
  return corners;
}

/** Pieces [from, to) are plain straights (a jump or the start line breaks an S). */
function onlyStraights(pieces: TrackFile['pieces'], from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (pieces[i]!.type !== 'straight') return false;
  return true;
}

/** Corner icons drawn for a right turn in a 24 × 24 box (y down): a stroked path and a filled arrow head. Left turns mirror them. */
export const CORNER_ICONS: Record<CornerKind, { path: string; head: [number, number][] }> = {
  wide: { path: 'M7 22 C7 13 10 9 16 8', head: [[15, 4], [21, 8], [15, 12]] },
  tight: { path: 'M8 22 V9 H15', head: [[15, 5], [20, 9], [15, 13]] },
  hairpin: { path: 'M6 22 V10 A5 5 0 0 1 16 10 V14', head: [[12, 14], [20, 14], [16, 19]] },
  s: { path: 'M7 22 V19 C7 14 17 15 17 10 V8', head: [[13, 8], [17, 3], [21, 8]] },
};

/** Colour of each severity (HUD tag border, chevron boards, printed signs). */
export const SEVERITY_COLOR: Record<1 | 2 | 3, string> = { 1: '#b08a4a', 2: '#ff8a2a', 3: '#e0442c' };

/** Highest gear whose top speed is safe on a curve of `radius` (same rule as the autopilot). */
export function gearForRadius(radius: number, maxSpeed: number, lateralAccel: number): number {
  const safe = Math.sqrt(lateralAccel * radius);
  for (let g = GEAR_RATIOS.length; g >= 1; g--) if (GEAR_RATIOS[g - 1]! * maxSpeed <= safe) return g;
  return 1;
}

/** What the corner tag shows this frame. */
export interface CornerCue {
  corner: Corner;
  /** Bend shown: the next one ahead (inside an S, the one still to come). */
  bend: number;
  /** Distance to the shown bend's entry (m, 0 when already in the corner). */
  dist: number;
  /** 0..1, 1 = at the entry (fills the distance bar). */
  near: number;
  /** Already inside the corner (an S with bends to come). */
  inside: boolean;
}

export interface CueOptions {
  /** Warning time ahead at the current speed (s). */
  leadTime: number;
  /** Warning distance limits (m). */
  minLead: number;
  maxLead: number;
}

/**
 * The corner to warn about at lap distance `s` and forward speed `speed` (m/s), or null.
 * A corner is announced `lead` metres before its entry; inside an S the remaining bend stays
 * shown; inside the last bend the tag looks to the next corner.
 */
export function cornerCue(corners: Corner[], length: number, s: number, speed: number, opts: CueOptions): CornerCue | null {
  if (!corners.length || speed <= 0.5) return null;
  const lead = Math.min(opts.maxLead, Math.max(opts.minLead, speed * opts.leadTime));
  const ahead = (x: number) => (((x - s) % length) + length) % length;
  // Nearest corner whose exit is still ahead (wrapping round the lap).
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < corners.length; i++) {
    const c = corners[i]!;
    const inC = ahead(c.s0) > ahead(c.s1);
    const d = inC ? 0 : ahead(c.s0);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const c = corners[best]!;
  if (bestD > 0) return bestD <= lead ? { corner: c, bend: 0, dist: bestD, near: 1 - bestD / lead, inside: false } : null;
  // Inside: show the next bend of an S, if any.
  for (let b = 0; b < c.bends.length; b++) {
    const bd = c.bends[b]!;
    const inB = ahead(bd.s0) > ahead(bd.s1);
    if (!inB && ahead(bd.s0) < ahead(c.s1)) return { corner: c, bend: b, dist: ahead(bd.s0), near: 1 - Math.min(1, ahead(bd.s0) / lead), inside: true };
  }
  // In the last bend: look past this corner to the next one.
  const next = corners[(best + 1) % corners.length]!;
  if (next === c) return null;
  const d = ahead(next.s0);
  return d <= lead ? { corner: next, bend: 0, dist: d, near: 1 - d / lead, inside: false } : null;
}
