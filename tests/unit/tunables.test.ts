import { describe, expect, it, vi } from 'vitest';
import { TunableRegistry } from '../../src/core/tunables';

function make() {
  const r = new TunableRegistry();
  r.registerGroup('car', [
    { key: 'car.speed', type: 'number', default: 10, min: 0, max: 20 },
    { key: 'car.drift', type: 'boolean', default: false },
    { key: 'car.color', type: 'color', default: '#FF0000' },
    { key: 'car.mode', type: 'option', default: 'a', options: ['a', 'b'] },
  ]);
  return r;
}

describe('TunableRegistry', () => {
  it('returns defaults and clamps numbers', () => {
    const r = make();
    expect(r.get('car.speed')).toBe(10);
    r.set('car.speed', 99);
    expect(r.get('car.speed')).toBe(20);
    r.set('car.speed', Number.NaN);
    expect(r.get('car.speed')).toBe(20);
  });

  it('rejects invalid colors and options', () => {
    const r = make();
    r.set('car.color', 'red');
    r.set('car.mode', 'zzz');
    expect(r.get('car.color')).toBe('#FF0000');
    expect(r.get('car.mode')).toBe('a');
  });

  it('notifies listeners only on real changes', () => {
    const r = make();
    const fn = vi.fn();
    r.onChange(fn);
    r.set('car.speed', 10);
    r.set('car.speed', 12);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('car.speed', 12);
  });

  it('round-trips presets and ignores unknown keys', () => {
    const r = make();
    r.set('car.speed', 15);
    r.set('car.drift', true);
    const preset = r.toPreset();
    expect(preset).toEqual({ 'car.speed': 15, 'car.drift': true });
    r.reset();
    expect(r.get('car.speed')).toBe(10);
    expect(r.applyPreset({ ...preset, 'unknown.key': 1 })).toBe(2);
    expect(r.get<boolean>('car.drift')).toBe(true);
  });

  it('re-registering a key keeps the existing value', () => {
    const r = make();
    r.set('car.speed', 5);
    r.register({ key: 'car.speed', group: 'car', type: 'number', default: 1, min: 0, max: 20 });
    expect(r.get('car.speed')).toBe(5);
  });
});
