/**
 * Player actions (doc 03 §12, gameplay.md Appendix). The simulation only sees `ActionFrame`s.
 */
export const BUTTONS = [
  'steamPush', // steam push + gear up; boiler stalled = open the valve
  'gearDown', // gear down; held = brake, then reverse; boiler stalled = open the valve
  'vent', // dump steam / active defence
  'fireFront',
  'fireRear',
  'fireTurret',
  'card1',
  'card2',
  'card3',
  'reposition',
  'pause',
] as const;

export type Button = (typeof BUTTONS)[number];

export type ButtonMap = Record<Button, boolean>;

export function emptyButtons(): ButtonMap {
  return Object.fromEntries(BUTTONS.map((b) => [b, false])) as ButtonMap;
}

/** Raw state written by an input source. `latched` keeps taps shorter than one sim step. */
export interface RawInput {
  steer: number;
  held: ButtonMap;
  latched: ButtonMap;
}

export function emptyRaw(): RawInput {
  return { steer: 0, held: emptyButtons(), latched: emptyButtons() };
}

/** What a sim step receives for one player. */
export interface ActionFrame {
  /** -1 (left) .. +1 (right) */
  steer: number;
  /** Buttons currently down (or tapped since the last step). */
  held: ButtonMap;
  /** Buttons that went down since the last step (edge). */
  pressed: ButtonMap;
  /** Buttons that went up since the last step (edge). */
  released: ButtonMap;
}

export function emptyFrame(): ActionFrame {
  return { steer: 0, held: emptyButtons(), pressed: emptyButtons(), released: emptyButtons() };
}

export type DeviceKind = 'keyboard' | 'gamepad' | 'touch' | 'none';

export interface InputSource {
  readonly kind: DeviceKind;
  readonly id: string;
  /** Write the current state into `out` (merge: OR buttons, add steer). Returns true if any input is active. */
  read(out: RawInput): boolean;
  /** Clear latched taps after a sim step consumed them. */
  consume(): void;
  dispose?(): void;
}
