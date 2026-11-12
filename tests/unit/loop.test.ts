import { describe, expect, it } from 'vitest';
import { FixedStepLoop } from '../../src/core/loop';

describe('FixedStepLoop', () => {
  it('runs one step per 60 Hz frame', () => {
    const l = new FixedStepLoop();
    expect(l.advance(1 / 60).steps).toBe(1);
    expect(l.stepCount).toBe(1);
  });

  it('runs two steps per 30 Hz frame and keeps the remainder as alpha', () => {
    const l = new FixedStepLoop();
    const t = l.advance(1 / 30 + 0.5 / 60);
    expect(t.steps).toBe(2);
    expect(t.alpha).toBeCloseTo(0.5, 5);
  });

  it('caps substeps and drops the backlog (spiral of death guard)', () => {
    const l = new FixedStepLoop({ maxSteps: 4 });
    expect(l.advance(0.25).steps).toBe(4);
    expect(l.advance(0).steps).toBe(0);
  });

  it('clamps huge deltas (tab switch) and ignores negative ones', () => {
    const l = new FixedStepLoop({ maxSteps: 100 });
    expect(l.advance(10).frameDt).toBe(0.25);
    expect(l.advance(-1).steps).toBe(0);
  });

  it('does not step while paused, and timeScale slows the sim', () => {
    const l = new FixedStepLoop();
    l.paused = true;
    expect(l.advance(1 / 60).steps).toBe(0);
    l.paused = false;
    l.timeScale = 0.5;
    expect(l.advance(1 / 60).steps).toBe(0);
    expect(l.advance(1 / 60).steps).toBe(1);
  });

  it('simulates the same total time regardless of frame rate', () => {
    const a = new FixedStepLoop();
    const b = new FixedStepLoop();
    for (let i = 0; i < 600; i++) a.advance(1 / 60);
    for (let i = 0; i < 1440; i++) b.advance(1 / 144);
    expect(Math.abs(a.stepCount - b.stepCount)).toBeLessThanOrEqual(1);
  });
});
