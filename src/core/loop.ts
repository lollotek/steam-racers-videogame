/**
 * Fixed-timestep accumulator (doc 03 §4.1).
 * Pure logic, no DOM: the caller feeds frame deltas and runs `steps` simulation steps.
 */
export interface LoopTick {
  /** Number of fixed simulation steps to run this frame. */
  steps: number;
  /** Interpolation factor between previous and current sim state, 0..1. */
  alpha: number;
  /** Clamped real frame delta in seconds (for presentation-only effects). */
  frameDt: number;
}

export interface FixedStepOptions {
  step?: number;
  maxSteps?: number;
  maxFrameDt?: number;
}

export class FixedStepLoop {
  readonly step: number;
  readonly maxSteps: number;
  readonly maxFrameDt: number;
  timeScale = 1;
  paused = false;
  /** Total simulated time in seconds. */
  simTime = 0;
  /** Total simulation steps executed. */
  stepCount = 0;
  private acc = 0;

  constructor(opts: FixedStepOptions = {}) {
    this.step = opts.step ?? 1 / 60;
    this.maxSteps = opts.maxSteps ?? 4;
    this.maxFrameDt = opts.maxFrameDt ?? 0.25;
  }

  advance(realDt: number): LoopTick {
    const frameDt = Math.min(Math.max(realDt, 0), this.maxFrameDt);
    if (this.paused) return { steps: 0, alpha: this.acc / this.step, frameDt };

    this.acc += frameDt * this.timeScale;
    let steps = 0;
    while (this.acc >= this.step && steps < this.maxSteps) {
      this.acc -= this.step;
      steps++;
    }
    // Spiral-of-death guard: drop the backlog we could not simulate.
    if (steps === this.maxSteps && this.acc >= this.step) this.acc = this.acc % this.step;

    this.stepCount += steps;
    this.simTime = this.stepCount * this.step;
    return { steps, alpha: this.acc / this.step, frameDt };
  }

  /** Clear accumulated time, e.g. after the tab was hidden. */
  resetAccumulator(): void {
    this.acc = 0;
  }
}
