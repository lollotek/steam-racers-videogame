import { describe, expect, it } from 'vitest';
import { TAM_LEVELS, generateStrokes } from '../../src/render/procedural/strokes';

describe('procedural TAM strokes', () => {
  it('is deterministic for a seed', () => {
    expect(generateStrokes(5, TAM_LEVELS[0]!)).toEqual(generateStrokes(5, TAM_LEVELS[0]!));
    expect(generateStrokes(5, TAM_LEVELS[0]!)).not.toEqual(generateStrokes(6, TAM_LEVELS[0]!));
  });

  it('denser levels have more strokes, all inside the tile with bounded angle jitter', () => {
    for (let i = 1; i < TAM_LEVELS.length; i++) expect(TAM_LEVELS[i]!.count).toBeGreaterThanOrEqual(TAM_LEVELS[i - 1]!.count);
    for (const level of TAM_LEVELS) {
      const strokes = generateStrokes(1, level);
      expect(strokes).toHaveLength(level.count);
      for (const s of strokes) {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x).toBeLessThan(1);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeLessThan(1);
        expect(Math.abs(s.angle - level.angle)).toBeLessThanOrEqual((4 * Math.PI) / 180 + 1e-9);
      }
    }
  });

  it('covers the tile evenly (jittered grid): every quadrant gets strokes', () => {
    const strokes = generateStrokes(9, TAM_LEVELS[0]!);
    const q = [0, 0, 0, 0];
    for (const s of strokes) q[(s.x < 0.5 ? 0 : 1) + (s.y < 0.5 ? 0 : 2)]!++;
    for (const n of q) expect(n).toBeGreaterThan(TAM_LEVELS[0]!.count * 0.15);
  });
});
