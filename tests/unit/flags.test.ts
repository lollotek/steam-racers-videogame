import { describe, expect, it } from 'vitest';
import { parseFlags } from '../../src/core/flags';

describe('parseFlags', () => {
  it('has sane defaults', () => {
    expect(parseFlags('')).toEqual({
      debug: false,
      tier: null,
      forceWebGL: false,
      seed: 1,
      racers: 4,
      players: 1,
      touch: null,
      test: false,
      laps: null,
      track: null,
      fullscreen: true,
    });
  });

  it('parses all flags and clamps values', () => {
    const f = parseFlags('?debug&tier=low&backend=webgl2&seed=77&racers=12&players=2&touch=0&test');
    expect(f).toMatchObject({ debug: true, tier: 'low', forceWebGL: true, seed: 77, racers: 8, players: 2, touch: false, test: true });
  });

  it('ignores unknown tiers', () => {
    expect(parseFlags('?tier=potato').tier).toBeNull();
  });
});
