import { describe, expect, it } from 'vitest';
import { TunableRegistry } from '../../src/core/tunables';
import { applyTuning, buildTuningFile, extractJson, parseTuning } from '../../src/core/tuning-file';

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

describe('tuning files', () => {
  it('reads a full file', () => {
    const { file, warnings } = parseTuning(
      JSON.stringify({ format: 'steam-racers-tuning', version: 1, name: 'Fast', notes: 'why', params: { 'car.speed': 15, 'car.mode': 'b' } }),
      make(),
    );
    expect(warnings).toEqual([]);
    expect(file.name).toBe('Fast');
    expect(file.notes).toBe('why');
    expect(file.params).toEqual({ 'car.speed': 15, 'car.mode': 'b' });
  });

  it('accepts LLM-style output: prose, code fence, nested groups, numbers as text', () => {
    const text = 'Here is your file:\n```json\n{ "params": { "car": { "speed": "12", "drift": true } } }\n```\nEnjoy!';
    const { file, warnings } = parseTuning(text, make());
    expect(file.params).toEqual({ 'car.speed': 12, 'car.drift': true });
    expect(file.name).toBe('Untitled tuning');
    expect(warnings.some((w) => w.includes('as text'))).toBe(true);
  });

  it('accepts a bare preset map (debug panel export)', () => {
    expect(parseTuning('{"car.speed": 3}', make()).file.params).toEqual({ 'car.speed': 3 });
  });

  it('clamps, drops and reports bad values', () => {
    const { file, warnings } = parseTuning(
      JSON.stringify({ params: { 'car.speed': 99, 'car.mode': 'z', 'car.color': 'red', 'car.drift': 'yes', 'car.wings': 1, 'quality.tier': 'low' } }),
      make(),
    );
    expect(file.params).toEqual({ 'car.speed': 20, 'quality.tier': 'low' });
    expect(warnings).toHaveLength(5);
    expect(warnings.join('\n')).toMatch(/clamped to 20/);
    expect(warnings.join('\n')).toMatch(/Unknown parameter "car.wings"/);
  });

  it('rejects text without JSON', () => {
    expect(() => extractJson('no json here')).toThrow();
  });

  it('applies from the defaults and holds late keys until they register', () => {
    const r = make();
    r.set('car.mode', 'b');
    applyTuning(r, { format: 'steam-racers-tuning', version: 1, name: 'x', params: { 'car.speed': 5, 'late.k': 3 } });
    expect(r.get('car.mode')).toBe('a');
    expect(r.get('car.speed')).toBe(5);
    r.register({ key: 'late.k', group: 'late', type: 'number', default: 1, min: 0, max: 2 });
    expect(r.get('late.k')).toBe(2);
    applyTuning(r, null);
    expect(r.get('car.speed')).toBe(10);
  });

  it('exports only changed values, sorted', () => {
    const r = make();
    r.set('car.speed', 4);
    r.set('car.drift', true);
    expect(buildTuningFile(r, { name: 'n' }).params).toEqual({ 'car.drift': true, 'car.speed': 4 });
  });
});
