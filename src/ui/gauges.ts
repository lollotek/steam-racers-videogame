/**
 * Per-frame centre prompts for one player (gameplay.md §9.2): start test meter, boiler reliability
 * test (a valve ring on the ground under the vehicle), lock reticle on the cannon target, "under
 * fire" arrow. Needles move fast (the tests are
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

/** Screen point (px, page coordinates). */
export interface ScreenPoint {
  x: number;
  y: number;
}

export interface BoilerTestView {
  /** Needle 0..1, or null while the outcome flash shows. */
  needle: number | null;
  notch: number;
  half: number;
  kind: 'red' | 'burst';
  /**
   * The ring projected on screen: `inner` and `outer` edges sampled evenly from u = 0 (screen left)
   * through the point nearest the camera to u = 1 (screen right). Same length, at least 2 points.
   */
  inner: ScreenPoint[];
  outer: ScreenPoint[];
  /** Outcome flash after the test: hit (green) or miss (red). */
  flash: 'hit' | 'miss' | null;
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

const SVG = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, cls: string, parent: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  e.setAttribute('class', cls);
  parent.appendChild(e);
  return e;
}

/** Point at u (0..1) along a sampled edge, linear between samples, relative to (ox, oy). */
function along(pts: ScreenPoint[], u: number, ox: number, oy: number): [number, number] {
  const f = Math.max(0, Math.min(1, u)) * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
  const k = f - i;
  const a = pts[i]!;
  const b = pts[i + 1]!;
  return [a.x + (b.x - a.x) * k - ox, a.y + (b.y - a.y) * k - oy];
}

/** Closed band between the two edges from u0 to u1 (polygon `points`). */
function band(inner: ScreenPoint[], outer: ScreenPoint[], u0: number, u1: number, ox: number, oy: number): string {
  const n = Math.max(2, Math.ceil(Math.abs(u1 - u0) * (outer.length - 1)) + 1);
  const out: string[] = [];
  const at = (edge: ScreenPoint[], i: number) => {
    const [x, y] = along(edge, u0 + ((u1 - u0) * i) / (n - 1), ox, oy);
    out.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  };
  for (let i = 0; i < n; i++) at(outer, i);
  for (let i = n - 1; i >= 0; i--) at(inner, i);
  return out.join(' ');
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
  private ring: SVGSVGElement;
  private ringTrack: SVGPolygonElement;
  private ringFill: SVGPolygonElement;
  private ringNotch: SVGPolygonElement;
  private ringNeedle: SVGLineElement;
  private ringLabel: HTMLDivElement;
  private reticle: HTMLDivElement;
  private fire: HTMLDivElement;
  private last = { start: false, boiler: false, kind: '', flash: '-', reticle: false, locked: false, fire: false };

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
    this.ring = svg('svg', 'valve-ring', this.root);
    this.ring.dataset.testid = `boiler-test-${p}`;
    this.ringTrack = svg('polygon', 'valve-track', this.ring);
    this.ringFill = svg('polygon', 'valve-fill', this.ring);
    this.ringNotch = svg('polygon', 'valve-notch', this.ring);
    this.ringNeedle = svg('line', 'valve-needle', this.ring);
    this.ringLabel = el('valve-label', this.root);
    this.reticle = el('reticle', this.root, `reticle-${p}`);
    this.fire = el('under-fire', this.root, `under-fire-${p}`);
    el('under-fire-arrow', this.fire);
    el('under-fire-label', this.fire).textContent = 'UNDER FIRE';
    for (const e of [this.start, this.ring, this.ringLabel, this.reticle, this.fire]) e.style.display = 'none';
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

    this.updateRing(f);

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

  /** Valve ring on the ground (boiler stall): track, swept part, green notch, needle, label. */
  private updateRing(f: GaugeFrame): void {
    const b = f.boiler;
    const show = !!b && b.outer.length >= 2 && b.inner.length === b.outer.length;
    if (show !== this.last.boiler) {
      this.ring.style.display = this.ringLabel.style.display = show ? '' : 'none';
      this.last.boiler = show;
    }
    if (!b || !show) return;
    const flash = b.flash ?? '';
    if (b.kind !== this.last.kind || flash !== this.last.flash) {
      for (const e of [this.ring, this.ringLabel]) {
        e.classList.toggle('burst', b.kind === 'burst');
        e.classList.toggle('hit', flash === 'hit');
        e.classList.toggle('miss', flash === 'miss');
      }
      this.ringLabel.textContent =
        flash === 'hit' ? 'VALVE OK' : flash === 'miss' ? 'VALVE MISSED' : b.kind === 'burst' ? 'BURSTING! GEAR ON THE GREEN' : 'GEAR ON THE GREEN';
      this.last.kind = b.kind;
      this.last.flash = flash;
    }
    const { left: ox, top: oy } = f.vp;
    const { inner, outer } = b;
    this.ringTrack.setAttribute('points', band(inner, outer, 0, 1, ox, oy));
    this.ringNotch.setAttribute('points', band(inner, outer, b.notch - b.half, b.notch + b.half, ox, oy));
    const needle = b.needle;
    const showNeedle = needle !== null && needle > 0;
    this.ringFill.style.display = this.ringNeedle.style.display = showNeedle ? '' : 'none';
    if (showNeedle) {
      this.ringFill.setAttribute('points', band(inner, outer, 0, needle, ox, oy));
      // Needle across the band, a little longer than the band is wide.
      const [ix, iy] = along(inner, needle, ox, oy);
      const [qx, qy] = along(outer, needle, ox, oy);
      const ex = (qx - ix) * 0.4;
      const ey = (qy - iy) * 0.4;
      this.ringNeedle.setAttribute('x1', (ix - ex).toFixed(1));
      this.ringNeedle.setAttribute('y1', (iy - ey).toFixed(1));
      this.ringNeedle.setAttribute('x2', (qx + ex).toFixed(1));
      this.ringNeedle.setAttribute('y2', (qy + ey).toFixed(1));
    }
    // Label just below the point of the ring nearest the camera.
    const [lx, ly] = along(outer, 0.5, ox, oy);
    this.ringLabel.style.transform = `translate(${lx.toFixed(1)}px, ${(ly + 6).toFixed(1)}px) translateX(-50%)`;
  }

  dispose(): void {
    this.root.remove();
  }
}
