import { describe, expect, it } from 'vitest';
import { createHull } from '../../src/rules/hull';
import '../../src/render/ink/ink-uniforms';
import { hullBorderColor, type BorderColor } from '../../src/render/hull-border';

const out: BorderColor = { r: 0, g: 0, b: 0, alpha: 0 };
const at = (f: number, wrecked = false) => {
  const h = createHull(20, 0);
  h.pf = 20 * f;
  h.wrecked = wrecked;
  return { ...hullBorderColor(h, 0, out) };
};

describe('hull border colour', () => {
  it('is green at full hull, orange at the smoke threshold, red at the fire threshold', () => {
    const full = at(1);
    expect(full.g).toBeGreaterThan(full.r);
    const smoke = at(0.5);
    expect(smoke.r).toBeCloseTo(1, 2);
    expect(smoke.g).toBeGreaterThan(0.5);
    const fire = at(0.25);
    expect(fire.r).toBeCloseTo(1, 2);
    expect(fire.g).toBeLessThan(0.25);
  });

  it('fades monotonically from green to red', () => {
    let prevG = Infinity;
    for (let f = 1; f >= 0.25; f -= 0.05) {
      const c = at(f);
      expect(c.g).toBeLessThanOrEqual(prevG + 1e-6);
      prevG = c.g;
    }
  });

  it('stays visible: full opacity while healthy, pulsing but never gone while burning or wrecked', () => {
    expect(at(0.8).alpha).toBe(1);
    for (let t = 0; t < 1; t += 0.05) expect(hullBorderColor(Object.assign(createHull(20, 0), { pf: 2 }), t, out).alpha).toBeGreaterThanOrEqual(0.65);
    expect(at(0, true).alpha).toBeGreaterThan(0.5);
  });
});
