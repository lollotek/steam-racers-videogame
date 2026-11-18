/**
 * Corner tag: warns of the next corner above the player's vehicle (the gear + steam tag sits below).
 * Shows the corner kind (wide / tight / hairpin / S) mirrored for left turns, severity chevrons,
 * the advised gear (red while the current gear is higher) and a bar that fills on the approach.
 * Logic in track/corners.ts; per-frame direct DOM writes, bypassing Preact (doc 03 §2 UI/HUD).
 */
import { Vector3, type Camera } from 'three/webgpu';
import { CORNER_ICONS, type CornerCue, type CornerKind } from '../track/corners';
import { screenBelow, type ViewportRect } from './vehicle-tag';

/** SVG markup of the shared corner icons (viewBox 24×24, right turn; a left turn mirrors them). */
const ICONS = Object.fromEntries(
  Object.entries(CORNER_ICONS).map(([k, i]) => [k, `<path d="${i.path}"/><polygon points="${i.head.map((p) => p.join(',')).join(' ')}"/>`]),
) as Record<CornerKind, string>;

export class CornerTag {
  readonly el: HTMLDivElement;
  private iconEl: SVGSVGElement;
  private chevEl: HTMLSpanElement;
  private gearEl: HTMLSpanElement;
  private barEl: HTMLDivElement;
  private lastKey = '';
  private lastNear = -1;
  /** Own height (px), measured when the content changes. */
  private height = 40;
  /** Pinned under the gear tag (no room above, see `update`). */
  private under = false;
  private v = new Vector3();
  private up = new Vector3();

  constructor(
    parent: HTMLElement,
    readonly playerIndex: number,
  ) {
    const id = `ctag-p${playerIndex + 1}`;
    this.el = document.createElement('div');
    this.el.className = 'ctag';
    this.el.dataset.testid = id;
    const row = document.createElement('div');
    row.className = 'ctag-row';
    this.iconEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.iconEl.setAttribute('viewBox', '0 0 24 24');
    this.iconEl.classList.add('ctag-icon');
    this.chevEl = document.createElement('span');
    this.chevEl.className = 'ctag-chev';
    this.gearEl = document.createElement('span');
    this.gearEl.className = 'ctag-gear';
    this.gearEl.dataset.testid = `${id}-gear`;
    row.append(this.iconEl, this.chevEl, this.gearEl);
    const bar = document.createElement('div');
    bar.className = 'ctag-bar';
    this.barEl = document.createElement('div');
    bar.appendChild(this.barEl);
    this.el.append(row, bar);
    this.el.style.display = 'none';
    parent.appendChild(this.el);
  }

  /**
   * @param place where to pin it: `above` metres straight up the screen from the anchor; when its
   *   top would cross `safeTop` (px, under the HUD band) it goes under the gear tag instead, i.e.
   *   `below` metres down plus `belowPx`
   * @param advised gear advised for the shown bend
   */
  update(
    anchor: { x: number; y: number; z: number },
    place: { above: number; below: number; belowPx: number; safeTop: number },
    camera: Camera,
    vp: ViewportRect,
    cue: CornerCue | null,
    gear: number,
    advised: number,
  ): void {
    let at = cue ? screenBelow(anchor, -place.above, camera, vp, this.v, this.up) : null;
    // Hysteresis (20 px) so it does not flip every frame on the edge of the HUD band.
    if (at) this.under = at.y - this.height < place.safeTop + (this.under ? 20 : 0);
    const under = this.under;
    if (at && under) at = screenBelow(anchor, place.below, camera, vp, this.v, this.up);
    this.el.style.display = at ? '' : 'none';
    if (!at || !cue) return;
    this.el.style.transform = under
      ? `translate(${at.x.toFixed(1)}px, ${(at.y + place.belowPx).toFixed(1)}px) translate(-50%, 0)`
      : `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -100%)`;

    const c = cue.corner;
    const bend = c.bends[cue.bend]!;
    // Inside an S the remaining bend is shown on its own; before it, the whole corner.
    const kind: CornerKind = cue.inside ? bend.kind : c.kind;
    const turn = cue.inside ? bend.turn : c.turn;
    const severity = cue.inside ? ({ wide: 1, tight: 2, hairpin: 3 } as const)[bend.kind] : c.severity;
    const over = gear > advised;
    const key = `${kind}${turn}${severity}${advised}${over ? 'x' : ''}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.el.dataset.kind = kind;
      this.el.dataset.turn = turn;
      this.el.dataset.severity = String(severity);
      this.iconEl.innerHTML = ICONS[kind];
      this.iconEl.classList.toggle('left', turn === 'L');
      this.chevEl.textContent = (turn === 'L' ? '‹' : '›').repeat(severity);
      this.gearEl.textContent = String(advised);
      this.gearEl.classList.toggle('over', over);
      this.height = this.el.offsetHeight || this.height;
    }
    const near = Math.round(cue.near * 50) / 50;
    if (near !== this.lastNear) {
      this.lastNear = near;
      this.barEl.style.width = `${(near * 100).toFixed(0)}%`;
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
