import { type Button, type InputSource, type RawInput } from './actions';
import { tunables } from '../core/tunables';

/** Standard-mapping button indices (https://w3c.github.io/gamepad/#remapping). */
export const PAD_BUTTONS: Partial<Record<Button, number[]>> = {
  steamPush: [0], // A
  vent: [1], // B
  fireTurret: [3], // Y
  fireRear: [4], // LB
  fireFront: [5], // RB
  gearDown: [6], // LT (analog)
  reposition: [8], // Back / View (hold)
  pause: [9], // Start / Menu
  card1: [12], // D-pad up
  card2: [14], // D-pad left
  card3: [15], // D-pad right
};

tunables.registerGroup('input', [
  { key: 'input.padDeadzone', type: 'number', default: 0.15, min: 0, max: 0.5, step: 0.01, label: 'Stick deadzone' },
  { key: 'input.padTriggerThreshold', type: 'number', default: 0.3, min: 0.05, max: 0.9, step: 0.05, label: 'Trigger threshold' },
]);

type PadProvider = () => (Gamepad | null)[];

const defaultProvider: PadProvider = () =>
  typeof navigator !== 'undefined' && navigator.getGamepads ? [...navigator.getGamepads()] : [];

export class GamepadSource implements InputSource {
  readonly kind = 'gamepad' as const;
  readonly id: string;

  constructor(
    readonly padIndex: number,
    private provider: PadProvider = defaultProvider,
  ) {
    this.id = `gamepad${padIndex}`;
  }

  get connected(): boolean {
    return !!this.provider()[this.padIndex];
  }

  read(out: RawInput): boolean {
    const pad = this.provider()[this.padIndex];
    if (!pad || !pad.connected) return false;
    const dead = tunables.get('input.padDeadzone');
    const trig = tunables.get('input.padTriggerThreshold');
    let active = false;

    const x = pad.axes[0] ?? 0;
    if (Math.abs(x) > dead) {
      // Rescale so the output starts at 0 right after the deadzone.
      out.steer += (Math.sign(x) * (Math.abs(x) - dead)) / (1 - dead);
      active = true;
    }
    for (const [b, idxs] of Object.entries(PAD_BUTTONS) as [Button, number[]][]) {
      for (const i of idxs) {
        const btn = pad.buttons[i];
        if (!btn) continue;
        const isDown = btn.pressed || btn.value > trig;
        if (isDown) {
          out.held[b] = true;
          active = true;
        }
      }
    }
    return active;
  }

  consume(): void {
    // Polled every step: nothing to latch.
  }
}
