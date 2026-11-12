import {
  type ActionFrame,
  type Button,
  BUTTONS,
  type DeviceKind,
  type InputSource,
  emptyFrame,
  emptyRaw,
} from './actions';

/**
 * Per-player input (doc 03 principle 9). A slot merges several sources
 * (e.g. keyboard + gamepad + touch in single player) and produces one ActionFrame per sim step.
 */
export class PlayerInput {
  readonly frame: ActionFrame = emptyFrame();
  lastDevice: DeviceKind = 'none';
  private raw = emptyRaw();
  private prevHeld = emptyFrame().held;

  constructor(
    readonly index: number,
    readonly sources: InputSource[],
  ) {}

  /** Call once per simulation step. */
  sample(): ActionFrame {
    const raw = this.raw;
    raw.steer = 0;
    for (const b of BUTTONS) {
      raw.held[b] = false;
      raw.latched[b] = false;
    }
    for (const s of this.sources) {
      if (s.read(raw)) this.lastDevice = s.kind;
      s.consume();
    }
    const f = this.frame;
    f.steer = Math.max(-1, Math.min(1, raw.steer));
    for (const b of BUTTONS) {
      const down = raw.held[b] || raw.latched[b];
      f.pressed[b] = (down && !this.prevHeld[b]) || (raw.latched[b] && this.prevHeld[b] && !raw.held[b]);
      f.released[b] = !raw.held[b] && this.prevHeld[b];
      f.held[b] = down;
      this.prevHeld[b] = raw.held[b];
    }
    return f;
  }

  /** Compact string for the debug monitor, e.g. "steer -1.00 | steamPush gearDown". */
  describe(): string {
    const held = (BUTTONS as readonly Button[]).filter((b) => this.frame.held[b]);
    return `${this.lastDevice} | steer ${this.frame.steer.toFixed(2)} | ${held.join(' ') || '-'}`;
  }

  dispose(): void {
    for (const s of this.sources) s.dispose?.();
  }
}
