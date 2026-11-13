import { describe, expect, it } from 'vitest';
import { DynamicResolution, TIERS, detectTier } from '../../src/render/quality';

describe('detectTier', () => {
  it('targets medium on a mid-range 2021 phone (D4)', () => {
    expect(detectTier({ backend: 'webgpu', isMobile: true, cores: 6, memoryGb: 4, screenPixels: 2.5e6 })).toBe('medium');
  });
  it('drops to low on weak phones', () => {
    expect(detectTier({ backend: 'webgl2', isMobile: true, cores: 4, memoryGb: 2, screenPixels: 1e6 })).toBe('low');
  });
  it('gives high/ultra on desktop WebGPU', () => {
    expect(detectTier({ backend: 'webgpu', isMobile: false, cores: 8, memoryGb: 8, screenPixels: 2e6 })).toBe('high');
    expect(detectTier({ backend: 'webgpu', isMobile: false, cores: 16, memoryGb: 8, screenPixels: 2e6 })).toBe('ultra');
  });
});

describe('DynamicResolution', () => {
  const run = (d: DynamicResolution, ms: number, seconds: number) => {
    for (let t = 0; t < seconds * 1000; t += ms) d.update(ms);
  };

  it('lowers scale when frames are slow, never below the tier minimum', () => {
    const d = new DynamicResolution(TIERS.medium, 30);
    run(d, 50, 30);
    expect(d.scale).toBe(TIERS.medium.minRenderScale);
  });

  it('raises scale when frames are fast, never above the tier maximum', () => {
    const d = new DynamicResolution(TIERS.medium, 30);
    run(d, 10, 30);
    expect(d.scale).toBe(TIERS.medium.maxRenderScale);
  });

  it('stays put when on budget', () => {
    const d = new DynamicResolution(TIERS.high, 60);
    run(d, 1000 / 60, 10);
    expect(d.scale).toBe(TIERS.high.renderScale);
  });

  it('ignores isolated hitches (shader compile, tab switch) and forgets history on reset', () => {
    const d = new DynamicResolution(TIERS.high, 60);
    for (let i = 0; i < 20; i++) {
      d.update(2000);
      run(d, 1000 / 60, 0.5);
    }
    expect(d.scale).toBe(TIERS.high.renderScale);
    run(d, 40, 0.9); // almost long enough to lower the scale…
    d.reset(); // …but a new race starts
    run(d, 40, 0.9);
    expect(d.scale).toBe(TIERS.high.renderScale);
  });

  it('does nothing when disabled', () => {
    const d = new DynamicResolution(TIERS.medium, 30);
    d.enabled = false;
    run(d, 100, 10);
    expect(d.scale).toBe(TIERS.medium.renderScale);
  });
});
