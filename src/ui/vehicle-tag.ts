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

export class VehicleTag {
  readonly el: HTMLDivElement;
  private gearEl: HTMLSpanElement;
  private pipsEl: HTMLDivElement;
  private lastGear = -1;
  private lastPips = '';
  private v = new Vector3();

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
   * @param anchor world point the tag hangs from (just behind the vehicle, on the ground)
   */
  update(anchor: { x: number; y: number; z: number }, camera: Camera, vp: ViewportRect, gear: number, steam: SteamReadout, visible: boolean): void {
    this.v.set(anchor.x, anchor.y, anchor.z).project(camera);
    const onScreen = visible && this.v.z < 1 && Math.abs(this.v.x) < 1.2 && Math.abs(this.v.y) < 1.2;
    this.el.style.display = onScreen ? '' : 'none';
    if (!onScreen) return;
    const x = vp.left + (this.v.x * 0.5 + 0.5) * vp.width;
    const y = vp.top + (-this.v.y * 0.5 + 0.5) * vp.height;
    this.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, 0)`;

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
