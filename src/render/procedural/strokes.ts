/**
 * Procedural pen strokes for the hatching Tonal Art Map (doc 02 §4.1, S3: procedural first).
 * Pure + seeded: the stroke layout is unit tested; drawing happens in textures.ts.
 */
import { Rng } from '../../core/rng';

export interface Stroke {
  /** Centre in texture space, 0..1 (tileable: drawn wrapped). */
  x: number;
  y: number;
  /** Length in texture-space units. */
  length: number;
  /** Radians. */
  angle: number;
  /** Width in texels. */
  width: number;
  opacity: number;
}

export interface StrokeLevel {
  count: number;
  angle: number;
  /** Mean length as a fraction of the tile. */
  length: number;
  width: number;
}

/** TAM levels: R light, G medium (same direction, denser), B cross-hatch, A dense scribble. */
export const TAM_LEVELS: readonly StrokeLevel[] = [
  { count: 240, angle: Math.PI / 4, length: 0.07, width: 3.2 },
  { count: 520, angle: Math.PI / 4, length: 0.07, width: 3.2 },
  { count: 520, angle: -Math.PI / 4, length: 0.07, width: 3.0 },
  { count: 900, angle: Math.PI / 12, length: 0.035, width: 2.2 },
];

export function generateStrokes(seed: number, level: StrokeLevel): Stroke[] {
  const rng = new Rng(seed);
  const out: Stroke[] = [];
  // Jittered grid keeps coverage even (pure random leaves holes and clumps).
  const cols = Math.ceil(Math.sqrt(level.count));
  for (let i = 0; i < level.count; i++) {
    const cx = (i % cols) / cols;
    const cy = Math.floor(i / cols) / cols;
    out.push({
      x: (cx + rng.next() / cols) % 1,
      y: (cy + rng.next() / cols) % 1,
      length: level.length * rng.range(0.7, 1.3),
      angle: level.angle + rng.range(-1, 1) * ((4 * Math.PI) / 180), // ±4° jitter
      width: level.width * rng.range(0.8, 1.2),
      opacity: rng.range(0.75, 1),
    });
  }
  return out;
}
