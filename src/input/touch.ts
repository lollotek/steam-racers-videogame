import { type Button, type InputSource, type RawInput, emptyButtons } from './actions';

/**
 * Touch source. The on-screen controls (ui/TouchControls.tsx) call these setters;
 * this class only stores state for the simulation to read.
 */
export class TouchSource implements InputSource {
  readonly kind = 'touch' as const;
  readonly id = 'touch';
  private steer = 0;
  private held = emptyButtons();
  private latched = emptyButtons();

  setSteer(v: number): void {
    this.steer = Math.max(-1, Math.min(1, v));
  }

  press(b: Button): void {
    if (!this.held[b]) this.latched[b] = true;
    this.held[b] = true;
  }

  release(b: Button): void {
    this.held[b] = false;
  }

  releaseAll(): void {
    this.steer = 0;
    for (const k in this.held) this.held[k as Button] = false;
  }

  read(out: RawInput): boolean {
    let active = false;
    if (this.steer !== 0) {
      out.steer += this.steer;
      active = true;
    }
    for (const k in this.held) {
      const b = k as Button;
      if (this.held[b]) {
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
}
