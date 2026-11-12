import { type Button, type InputSource, type RawInput, emptyButtons } from './actions';

export interface KeyBindings {
  steerLeft: string[];
  steerRight: string[];
  buttons: Partial<Record<Button, string[]>>;
}

/** Keyboard player 1 (gameplay.md Appendix). Values are `KeyboardEvent.code`. */
export const P1_KEYS: KeyBindings = {
  steerLeft: ['ArrowLeft'],
  steerRight: ['ArrowRight'],
  buttons: {
    steamPush: ['ArrowUp'],
    gearDown: ['ArrowDown'],
    vent: ['ShiftRight'],
    fireFront: ['ControlRight', 'Period'],
    fireRear: ['End'],
    fireTurret: ['Delete'],
    card1: ['Insert'],
    card2: ['Home'],
    card3: ['PageUp'],
    reposition: ['Backspace', 'KeyR'],
    pause: ['Escape', 'KeyP'],
  },
};

/** Keyboard player 2 (split screen). */
export const P2_KEYS: KeyBindings = {
  steerLeft: ['KeyA'],
  steerRight: ['KeyD'],
  buttons: {
    steamPush: ['KeyW'],
    gearDown: ['KeyS'],
    vent: ['ShiftLeft'],
    fireFront: ['KeyX'],
    fireRear: ['KeyZ'],
    fireTurret: ['KeyV'],
    card1: ['Digit1'],
    card2: ['Digit2'],
    card3: ['Digit3'],
    reposition: ['KeyE'],
  },
};

export function mergeBindings(...sets: KeyBindings[]): KeyBindings {
  const out: KeyBindings = { steerLeft: [], steerRight: [], buttons: {} };
  for (const s of sets) {
    out.steerLeft.push(...s.steerLeft);
    out.steerRight.push(...s.steerRight);
    for (const [b, codes] of Object.entries(s.buttons) as [Button, string[]][]) {
      out.buttons[b] = [...(out.buttons[b] ?? []), ...codes];
    }
  }
  return out;
}

/** Keys the game consumes: the browser default (scrolling, back navigation…) is prevented. */
function allCodes(b: KeyBindings): Set<string> {
  return new Set([...b.steerLeft, ...b.steerRight, ...Object.values(b.buttons).flat()]);
}

export class KeyboardSource implements InputSource {
  readonly kind = 'keyboard' as const;
  private down = new Set<string>();
  private latched = emptyButtons();
  private codeToButton = new Map<string, Button>();
  private codes: Set<string>;

  constructor(
    readonly id: string,
    private bindings: KeyBindings,
    private target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
  ) {
    for (const [b, codes] of Object.entries(bindings.buttons) as [Button, string[]][]) {
      for (const c of codes) this.codeToButton.set(c, b);
    }
    this.codes = allCodes(bindings);
    target.addEventListener('keydown', this.onDown as EventListener);
    target.addEventListener('keyup', this.onUp as EventListener);
    target.addEventListener('blur', this.onBlur);
  }

  private onDown = (e: KeyboardEvent) => {
    if (!this.codes.has(e.code)) return;
    e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    const b = this.codeToButton.get(e.code);
    if (b) this.latched[b] = true;
  };

  private onUp = (e: KeyboardEvent) => {
    if (!this.codes.has(e.code)) return;
    this.down.delete(e.code);
  };

  private onBlur = () => this.down.clear();

  read(out: RawInput): boolean {
    let active = false;
    const any = (codes: string[]) => codes.some((c) => this.down.has(c));
    const steer = (any(this.bindings.steerRight) ? 1 : 0) - (any(this.bindings.steerLeft) ? 1 : 0);
    if (steer !== 0) {
      out.steer += steer;
      active = true;
    }
    for (const [b, codes] of Object.entries(this.bindings.buttons) as [Button, string[]][]) {
      if (any(codes)) {
        out.held[b] = true;
        active = true;
      }
      if (this.latched[b]) {
        out.latched[b] = true;
        active = true;
      }
    }
    return active;
  }

  consume(): void {
    for (const k in this.latched) this.latched[k as Button] = false;
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onDown as EventListener);
    this.target.removeEventListener('keyup', this.onUp as EventListener);
    this.target.removeEventListener('blur', this.onBlur);
  }
}
