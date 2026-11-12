import { describe, expect, it } from 'vitest';
import { PlayerInput } from '../../src/input/input-manager';
import { KeyboardSource, P1_KEYS, P2_KEYS, mergeBindings } from '../../src/input/keyboard';
import { GamepadSource } from '../../src/input/gamepad';
import { TouchSource } from '../../src/input/touch';

class FakeTarget {
  private l = new Map<string, ((e: unknown) => void)[]>();
  addEventListener(t: string, fn: (e: unknown) => void) {
    this.l.set(t, [...(this.l.get(t) ?? []), fn]);
  }
  removeEventListener() {}
  key(type: 'keydown' | 'keyup', code: string, repeat = false) {
    for (const fn of this.l.get(type) ?? []) fn({ code, repeat, preventDefault() {} });
  }
}

const kb = (bindings = P1_KEYS) => {
  const target = new FakeTarget();
  const src = new KeyboardSource('kb', bindings, target as unknown as Window);
  return { target, src };
};

describe('keyboard', () => {
  it('maps P1 arrows to steer and steam push with edges', () => {
    const { target, src } = kb();
    const p = new PlayerInput(0, [src]);
    target.key('keydown', 'ArrowUp');
    target.key('keydown', 'ArrowLeft');
    let f = p.sample();
    expect(f.steer).toBe(-1);
    expect(f.pressed.steamPush).toBe(true);
    expect(f.held.steamPush).toBe(true);
    f = p.sample();
    expect(f.pressed.steamPush).toBe(false);
    expect(f.held.steamPush).toBe(true);
    target.key('keyup', 'ArrowUp');
    f = p.sample();
    expect(f.released.steamPush).toBe(true);
    expect(p.lastDevice).toBe('keyboard');
  });

  it('keeps a tap shorter than one sim step', () => {
    const { target, src } = kb();
    const p = new PlayerInput(0, [src]);
    target.key('keydown', 'ArrowDown');
    target.key('keyup', 'ArrowDown');
    expect(p.sample().pressed.gearDown).toBe(true);
    expect(p.sample().pressed.gearDown).toBe(false);
  });

  it('ignores key repeat', () => {
    const { target, src } = kb();
    const p = new PlayerInput(0, [src]);
    target.key('keydown', 'ArrowUp');
    p.sample();
    target.key('keydown', 'ArrowUp', true);
    expect(p.sample().pressed.steamPush).toBe(false);
  });

  it('P2 uses WASD and ignores arrows; merged set accepts both', () => {
    const p2 = kb(P2_KEYS);
    const pi = new PlayerInput(1, [p2.src]);
    p2.target.key('keydown', 'ArrowRight');
    expect(pi.sample().steer).toBe(0);
    p2.target.key('keydown', 'KeyD');
    expect(pi.sample().steer).toBe(1);

    const both = kb(mergeBindings(P1_KEYS, P2_KEYS));
    const pb = new PlayerInput(0, [both.src]);
    both.target.key('keydown', 'KeyW');
    expect(pb.sample().pressed.steamPush).toBe(true);
  });

  it('every gameplay action has a P1 and P2 binding (gameplay.md Appendix)', () => {
    for (const b of ['steamPush', 'gearDown', 'vent', 'fireFront', 'fireRear', 'fireTurret', 'card1', 'card2', 'card3', 'reposition'] as const) {
      expect(P1_KEYS.buttons[b]?.length, `P1 ${b}`).toBeGreaterThan(0);
      expect(P2_KEYS.buttons[b]?.length, `P2 ${b}`).toBeGreaterThan(0);
    }
  });
});

describe('gamepad', () => {
  const pad = (axes: number[], pressed: number[] = [], values: Record<number, number> = {}) =>
    ({
      connected: true,
      axes,
      buttons: Array.from({ length: 17 }, (_, i) => ({
        pressed: pressed.includes(i),
        value: values[i] ?? (pressed.includes(i) ? 1 : 0),
      })),
    }) as unknown as Gamepad;

  it('applies the deadzone and maps A / LT', () => {
    let state = pad([0.1]);
    const p = new PlayerInput(0, [new GamepadSource(0, () => [state])]);
    expect(p.sample().steer).toBe(0);
    state = pad([1], [0], { 6: 0.8 });
    const f = p.sample();
    expect(f.steer).toBeCloseTo(1);
    expect(f.pressed.steamPush).toBe(true);
    expect(f.held.gearDown).toBe(true);
    expect(p.lastDevice).toBe('gamepad');
  });

  it('is inactive when no pad is connected', () => {
    const p = new PlayerInput(0, [new GamepadSource(1, () => [])]);
    expect(p.sample().steer).toBe(0);
    expect(p.lastDevice).toBe('none');
  });
});

describe('touch', () => {
  it('press/release and steer clamp', () => {
    const t = new TouchSource();
    const p = new PlayerInput(0, [t]);
    t.setSteer(3);
    t.press('steamPush');
    let f = p.sample();
    expect(f.steer).toBe(1);
    expect(f.pressed.steamPush).toBe(true);
    t.release('steamPush');
    f = p.sample();
    expect(f.released.steamPush).toBe(true);
    expect(p.lastDevice).toBe('touch');
  });

  it('merges with keyboard: steer sums and clamps', () => {
    const t = new TouchSource();
    const { target, src } = kb();
    const p = new PlayerInput(0, [src, t]);
    t.setSteer(0.8);
    target.key('keydown', 'ArrowRight');
    expect(p.sample().steer).toBe(1);
  });
});
