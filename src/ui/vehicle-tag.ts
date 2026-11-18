/**
 * Under-vehicle tag: current gear + steam-point pips, pinned below the player's vehicle on screen
 * so the driver does not have to look away to the HUD corner.
 * Per-frame gauge → direct DOM writes, bypassing Preact (doc 03 §2 UI/HUD).
 */
import { Vector3, type Camera } from 'three/webgpu';
import { pipsKey, steamPips, type SteamReadout } from './steam-pips';

export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Screen point (px) `below` metres straight down the screen from a world anchor, or null when the
 * anchor is off screen. Negative `below` goes up. `v`/`up` are scratch vectors.
 */
export function screenBelow(anchor: { x: number; y: number; z: number }, below: number, camera: Camera, vp: ViewportRect, v: Vector3, up: Vector3): { x: number; y: number } | null {
  v.set(anchor.x, anchor.y, anchor.z).project(camera);
  if (!(v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2)) return null;
  const x = vp.left + (v.x * 0.5 + 0.5) * vp.width;
  const ndcY = v.y;
  // Pixels per metre at the vehicle, measured along the camera's up axis (screen vertical).
  up.setFromMatrixColumn(camera.matrixWorld, 1).add(v.set(anchor.x, anchor.y, anchor.z)).project(camera);
  const pxPerM = Math.abs(up.y - ndcY) * 0.5 * vp.height;
  return { x, y: vp.top + (-ndcY * 0.5 + 0.5) * vp.height + below * pxPerM };
}

export class VehicleTag {
  readonly el: HTMLDivElement;
  private gearEl: HTMLSpanElement;
  private pipsEl: HTMLDivElement;
  private lastGear = -1;
  private lastPips = '';
  private v = new Vector3();
  private up = new Vector3();

  constructor(
    parent: HTMLElement,
    readonly playerIndex: number,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'vtag';
    this.el.dataset.testid = `vtag-p${playerIndex + 1}`;
    this.gearEl = document.createElement('span');
    this.gearEl.className = 'vtag-gear';
    this.gearEl.dataset.testid = `vtag-gear-p${playerIndex + 1}`;
    this.pipsEl = document.createElement('div');
    this.pipsEl.className = 'vtag-pips';
    this.pipsEl.dataset.testid = `vtag-pips-p${playerIndex + 1}`;
    this.el.append(this.gearEl, this.pipsEl);
    parent.appendChild(this.el);
  }

  /**
   * @param anchor vehicle position on the ground
   * @param below distance (m, at the vehicle) straight down the screen from the anchor: the tag
   *   stays centred under the vehicle whatever its heading or the camera angle
   */
  update(anchor: { x: number; y: number; z: number }, below: number, camera: Camera, vp: ViewportRect, gear: number, steam: SteamReadout, visible: boolean): void {
    const at = visible ? screenBelow(anchor, below, camera, vp, this.v, this.up) : null;
    this.el.style.display = at ? '' : 'none';
    if (!at) return;
    this.el.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, 0)`;

    if (gear !== this.lastGear) {
      this.lastGear = gear;
      this.gearEl.textContent = String(gear);
      this.gearEl.classList.toggle('red', gear >= 5);
    }
    const pips = steamPips(steam);
    const key = pipsKey(pips);
    if (key !== this.lastPips) {
      this.lastPips = key;
      this.pipsEl.replaceChildren(
        ...pips.map((p) => {
          const i = document.createElement('i');
          i.className = `pip ${p.kind}`;
          if (p.kind === 'empty' && p.fill > 0) i.style.setProperty('--fill', `${Math.round(p.fill * 100)}%`);
          return i;
        }),
      );
    }
  }

  dispose(): void {
    this.el.remove();
  }
}
