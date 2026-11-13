/**
 * Per-frame centre prompts for one player (gameplay.md §9.2): start test meter, boiler reliability
 * test, lock reticle on the cannon target, "under fire" arrow. Needles move fast (the tests are
 * timing games), so these are direct DOM writes every frame, not throttled Preact (doc 03 §13).
 */
import type { ViewportRect } from './vehicle-tag';

export interface StartTestView {
  needle: number;
  lo: number;
  hi: number;
  tol: number;
  red: number;
}

export interface BoilerTestView {
  needle: number;
  notch: number;
  half: number;
  kind: 'red' | 'burst';
}

export interface ReticleView {
  /** Screen position (px, page coordinates) and radius of the cone at the target. */
  x: number;
  y: number;
  r: number;
  locked: boolean;
}

export interface GaugeFrame {
  vp: ViewportRect;
  start: StartTestView | null;
  boiler: BoilerTestView | null;
  reticle: ReticleView | null;
  /** Direction to the attacker on screen (radians, 0 = up, clockwise), or null. */
  underFire: number | null;
}

const pct = (v: number) => `${(Math.max(0, Math.min(1, v)) * 100).toFixed(2)}%`;

function el(cls: string, parent: HTMLElement, testid?: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  if (testid) d.dataset.testid = testid;
  parent.appendChild(d);
  return d;
}

export class PlayerGauges {
  readonly root: HTMLDivElement;
  private start: HTMLDivElement;
  private startBand: HTMLDivElement;
  private startTol: HTMLDivElement;
  private startRed: HTMLDivElement;
  private startNeedle: HTMLDivElement;
  private boiler: HTMLDivElement;
  private boilerNotch: HTMLDivElement;
  private boilerNeedle: HTMLDivElement;
  private reticle: HTMLDivElement;
  private fire: HTMLDivElement;
  private last = { start: false, boiler: false, kind: '', reticle: false, locked: false, fire: false };

  constructor(parent: HTMLElement, index: number) {
    const p = `p${index + 1}`;
    this.root = el('gauges', parent, `gauges-${p}`);
    this.start = el('meter start-meter', this.root, `start-test-${p}`);
    el('meter-label', this.start).textContent = 'HOLD STEAM IN THE GREEN';
    const st = el('meter-track', this.start);
    this.startBand = el('meter-band', st);
    this.startTol = el('meter-tol', st);
    this.startRed = el('meter-red', st);
    this.startNeedle = el('meter-needle', st);
    this.boiler = el('meter boiler-meter', this.root, `boiler-test-${p}`);
    el('meter-label', this.boiler).textContent = 'VENT ON THE GREEN!';
    const bt = el('meter-track', this.boiler);
    this.boilerNotch = el('meter-band', bt);
    this.boilerNeedle = el('meter-needle', bt);
    this.reticle = el('reticle', this.root, `reticle-${p}`);
    this.fire = el('under-fire', this.root, `under-fire-${p}`);
    el('under-fire-arrow', this.fire);
    el('under-fire-label', this.fire).textContent = 'UNDER FIRE';
    for (const e of [this.start, this.boiler, this.reticle, this.fire]) e.style.display = 'none';
  }

  update(f: GaugeFrame | null): void {
    this.root.style.display = f ? '' : 'none';
    if (!f) return;
    const { vp } = f;
    this.root.style.left = `${vp.left}px`;
    this.root.style.top = `${vp.top}px`;
    this.root.style.width = `${vp.width}px`;
    this.root.style.height = `${vp.height}px`;

    const s = f.start;
    if (!!s !== this.last.start) this.start.style.display = s ? '' : 'none';
    this.last.start = !!s;
    if (s) {
      this.startBand.style.left = pct(s.lo);
      this.startBand.style.width = pct(s.hi - s.lo);
      this.startTol.style.left = pct(s.hi);
      this.startTol.style.width = pct(s.tol);
      this.startRed.style.left = pct(s.red);
      this.startNeedle.style.left = pct(s.needle);
      this.start.classList.toggle('in', s.needle >= s.lo && s.needle <= s.hi + s.tol);
    }

    const b = f.boiler;
    if (!!b !== this.last.boiler) this.boiler.style.display = b ? '' : 'none';
    this.last.boiler = !!b;
    if (b) {
      if (b.kind !== this.last.kind) {
        this.boiler.classList.toggle('burst', b.kind === 'burst');
        this.last.kind = b.kind;
      }
      this.boilerNotch.style.left = pct(b.notch - b.half);
      this.boilerNotch.style.width = pct(b.half * 2);
      this.boilerNeedle.style.left = pct(b.needle);
    }

    const r = f.reticle;
    if (!!r !== this.last.reticle) this.reticle.style.display = r ? '' : 'none';
    this.last.reticle = !!r;
    if (r) {
      const d = Math.max(18, r.r * 2);
      this.reticle.style.transform = `translate(${(r.x - vp.left).toFixed(1)}px, ${(r.y - vp.top).toFixed(1)}px) translate(-50%, -50%)`;
      this.reticle.style.width = this.reticle.style.height = `${d.toFixed(0)}px`;
      if (r.locked !== this.last.locked) {
        this.reticle.classList.toggle('locked', r.locked);
        this.last.locked = r.locked;
      }
    }

    const a = f.underFire;
    if ((a !== null) !== this.last.fire) this.fire.style.display = a !== null ? '' : 'none';
    this.last.fire = a !== null;
    if (a !== null) this.fire.style.setProperty('--angle', `${a.toFixed(3)}rad`);
  }

  dispose(): void {
    this.root.remove();
  }
}
