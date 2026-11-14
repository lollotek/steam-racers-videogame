/**
 * Shared track rules of the Cup worlds (doc 04 §4), as a pure check over a compiled track.
 * Used by the unit tests and by `tools/track/check.ts` while authoring a layout.
 */
import type { CompiledTrack } from './compile';
import { asArray, type Barricade, type Surface } from './track-format';
import { resolveHazard } from './hazards';
import { CELL, SQUARE, WIDTH, boundOfLine, columnOfLane, laneOfColumn, lineOfBound } from './units';

export interface TrackReport {
  id: string;
  length: number;
  /** Longest run of straight pieces (start included), metres. */
  longestStraight: number;
  /** Two consecutive same-direction curves of size ≤ 2 (a 180° turn). */
  hairpins: number;
  /** Size-1 curves (10 m radius). */
  tightCorners: number;
  surfaces: Surface[];
  barricades: Barricade[];
  hazards: number;
  landmarks: number;
  jumps: number;
  /** Height range in metres. */
  heightRange: number;
  /** Rule violations (empty = OK). */
  problems: string[];
}

export const CUP_RULES = {
  minLength: 1000,
  maxLength: 1400,
  minStraight: 80,
  maxHairpins: 2,
  minBarricades: 3,
} as const;

export function checkTrack(t: CompiledTrack): TrackReport {
  const pieces = t.file.pieces;
  const cell = t.file.cell;
  let longest = 0;
  let run = 0;
  // Straight runs, wrapping from the last pieces into the start.
  for (let k = 0; k < pieces.length * 2; k++) {
    const p = pieces[k % pieces.length]!;
    if (p.type === 'straight' || p.type === 'start') {
      run += (p.size ?? 1) * cell;
      longest = Math.max(longest, run);
    } else run = 0;
    if (run > t.length) break;
  }
  let hairpins = 0;
  for (let k = 0; k < pieces.length; k++) {
    const a = pieces[k]!;
    const b = pieces[(k + 1) % pieces.length]!;
    if (a.type === 'curve' && b.type === 'curve' && a.turn === b.turn && (a.size ?? 1) <= 2 && (b.size ?? 1) <= 2) hairpins++;
  }
  const surfaces = [...new Set(t.samples.map((s) => s.surface))];
  const barricades = [...new Set(t.samples.flatMap((s) => [s.left, s.right]))];
  const report: TrackReport = {
    id: t.file.id,
    length: Math.round(t.length),
    longestStraight: longest,
    hairpins,
    tightCorners: pieces.filter((p) => p.type === 'curve' && (p.size ?? 1) === 1).length,
    surfaces,
    barricades,
    hazards: t.hazards.length,
    landmarks: t.landmarks.length,
    jumps: t.jumps.length,
    heightRange: t.bounds.maxY - t.bounds.minY,
    problems: [],
  };
  const P = report.problems;
  if (t.length < CUP_RULES.minLength || t.length > CUP_RULES.maxLength) P.push(`lap length ${report.length} m outside ${CUP_RULES.minLength}–${CUP_RULES.maxLength} m`);
  if (longest < CUP_RULES.minStraight) P.push(`longest straight ${longest} m < ${CUP_RULES.minStraight} m`);
  if (hairpins < 1) P.push('no hairpin');
  if (hairpins > CUP_RULES.maxHairpins) P.push(`${hairpins} hairpins (max ${CUP_RULES.maxHairpins})`);
  if (surfaces.length < 2) P.push('no surface change');
  if (barricades.length < CUP_RULES.minBarricades) P.push(`only ${barricades.length} barricade types`);
  if (report.hazards < 1) P.push('no signature hazard');
  if (report.landmarks < 1) P.push('no landmark');
  if (pieces.every((p) => !p.rise && !p.crest && p.type !== 'jump')) P.push('no elevation');
  if (!pieces.some((p) => asArray(p.pickups).length)) P.push('no crates');
  P.push(...tabletopProblems(t.file));
  return report;
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;

/** Tabletop grid (units.ts): 20 m cells, 15 m road, crates on column centres, hazards on whole squares. */
export function tabletopProblems(file: CompiledTrack['file']): string[] {
  const P: string[] = [];
  if (file.cell !== CELL) P.push(`cell ${file.cell} m: the tabletop grid needs ${CELL} m`);
  if (file.width !== WIDTH) P.push(`width ${file.width} m: the tabletop grid needs ${WIDTH} m`);
  file.pieces.forEach((p, i) => {
    for (const s of asArray(p.pickups)) {
      const lane = s.lane ?? 0;
      if (!near(lane, laneOfColumn(columnOfLane(lane)))) P.push(`piece ${i}: crate lane ${lane} is not on a column`);
    }
    for (const spec of asArray(p.hazard)) {
      const h = resolveHazard(spec);
      if (!h.lanes.every((v) => near(v, boundOfLine(lineOfBound(v))))) P.push(`piece ${i}: ${spec.kind} lanes are not on column lines`);
      if (!near(h.length / SQUARE, Math.round(h.length / SQUARE))) P.push(`piece ${i}: ${spec.kind} length ${h.length} m is not whole squares`);
    }
  });
  return P;
}
