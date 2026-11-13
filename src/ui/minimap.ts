/**
 * Minimap (gameplay.md §9.2, top right): track outline from the compiled centre line and one dot
 * per racer in its identity colour; players bigger and ringed, wrecks crossed out.
 * Dots move every frame → direct SVG writes (doc 03 §13).
 */
import type { CompiledTrack } from '../track/compile';

const NS = 'http://www.w3.org/2000/svg';
const SIZE = 100;
const PAD = 6;

export interface MinimapDot {
  x: number;
  z: number;
  color: string;
  player: boolean;
  wrecked: boolean;
}

export class Minimap {
  readonly el: SVGSVGElement;
  private dots: SVGGElement[] = [];
  private map: (x: number, z: number) => [number, number];
  private lastKey: string[] = [];

  constructor(parent: HTMLElement, track: CompiledTrack) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of track.samples) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
    }
    const scale = (SIZE - PAD * 2) / Math.max(maxX - minX, maxZ - minZ, 1);
    const ox = PAD + (SIZE - PAD * 2 - (maxX - minX) * scale) / 2;
    const oy = PAD + (SIZE - PAD * 2 - (maxZ - minZ) * scale) / 2;
    // +X to the right, +Z up (same handedness as the default camera looking along +Z).
    this.map = (x, z) => [ox + (maxX - x) * scale, oy + (maxZ - z) * scale];

    this.el = document.createElementNS(NS, 'svg');
    this.el.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
    this.el.setAttribute('class', 'minimap');
    this.el.dataset.testid = 'minimap';
    this.el.style.display = 'none';
    const pts = track.samples.filter((_, i) => i % 3 === 0).map((s) => this.map(s.x, s.z).map((v) => v.toFixed(1)).join(',')).join(' ');
    const width = Math.max(1.5, track.halfWidth * 2 * scale);
    for (const [cls, w] of [['mm-edge', width + 2], ['mm-road', width]] as const) {
      const pl = document.createElementNS(NS, 'polygon');
      pl.setAttribute('points', pts);
      pl.setAttribute('class', cls);
      pl.setAttribute('stroke-width', String(w));
      this.el.appendChild(pl);
    }
    const line = track.samples.find((s) => Math.abs(s.s - track.lineS) < 2) ?? track.samples[0]!;
    const [lx, ly] = this.map(line.x, line.z);
    const start = document.createElementNS(NS, 'circle');
    start.setAttribute('cx', lx.toFixed(1));
    start.setAttribute('cy', ly.toFixed(1));
    start.setAttribute('r', '2');
    start.setAttribute('class', 'mm-start');
    this.el.appendChild(start);
    parent.appendChild(this.el);
  }

  update(dots: MinimapDot[], visible: boolean): void {
    this.el.style.display = visible ? '' : 'none';
    if (!visible) return;
    while (this.dots.length < dots.length) {
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'mm-dot');
      g.innerHTML = '<circle r="3"/><path d="M-3,-3L3,3M3,-3L-3,3"/>';
      this.el.appendChild(g);
      this.dots.push(g);
    }
    // Players drawn last (on top).
    dots.forEach((d, i) => {
      const g = this.dots[i]!;
      const [x, y] = this.map(d.x, d.z);
      g.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})`);
      const key = `${d.color}${d.player}${d.wrecked}`;
      if (this.lastKey[i] !== key) {
        this.lastKey[i] = key;
        g.setAttribute('class', `mm-dot ${d.player ? 'player' : ''} ${d.wrecked ? 'wreck' : ''}`);
        g.style.setProperty('--c', d.color);
        if (d.player) this.el.appendChild(g);
      }
    });
  }

  dispose(): void {
    this.el.remove();
  }
}
