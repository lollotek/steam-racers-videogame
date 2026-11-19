/**
 * Race intro director: plays the shot list of race/intro-shots.ts on the player cameras between the
 * loading screen and the countdown, then hands over to the race camera with one eased camera move.
 * The simulation does not step while it runs (the countdown starts after it); any button skips it.
 */
import { type PerspectiveCamera, Vector3 } from 'three/webgpu';
import { tunables } from '../core/tunables';
import { type IntroTimings, type Shot, easeInOut } from '../race/intro-shots';
import type { IntroCaption } from '../ui/state';

tunables.registerGroup('intro', [
  { key: 'intro.enabled', type: 'boolean', default: true, label: 'Race intro (fly-over before the countdown)' },
  { key: 'intro.establish', type: 'number', default: 3.4, min: 0, max: 10, step: 0.1, unit: 's', label: 'Track overview' },
  { key: 'intro.point', type: 'number', default: 2.2, min: 0, max: 6, step: 0.1, unit: 's', label: 'Key point fly-by (each)' },
  { key: 'intro.points', type: 'number', default: 3, min: 0, max: 6, step: 1, label: 'Key points shown' },
  { key: 'intro.grid', type: 'number', default: 3.4, min: 0, max: 10, step: 0.1, unit: 's', label: 'Starting grid' },
  { key: 'intro.hero', type: 'number', default: 2.4, min: 0, max: 6, step: 0.1, unit: 's', label: 'Player close-up' },
  { key: 'intro.handoff', type: 'number', default: 1.5, min: 0.1, max: 4, step: 0.1, unit: 's', label: 'Hand-over to the race camera' },
  { key: 'intro.skipHandoff', type: 'number', default: 0.7, min: 0.1, max: 3, step: 0.1, unit: 's', label: 'Hand-over after a skip' },
  { key: 'intro.skipGuard', type: 'number', default: 0.5, min: 0, max: 3, step: 0.1, unit: 's', label: 'Ignore skip input for' },
]);

export function introTimings(): IntroTimings {
  const g = (k: string) => tunables.get<number>(`intro.${k}`);
  return { establish: g('establish'), point: g('point'), points: g('points'), grid: g('grid'), hero: g('hero') };
}

export class RaceIntro {
  /** Current intro pose (before the hand-over blend). */
  readonly eye = new Vector3();
  readonly look = new Vector3();
  fov = 40;
  private index = 0;
  private t = 0;
  private elapsed = 0;
  /** Hand-over: seconds in (−1 = not started), its length and the pose it starts from. */
  private handT = -1;
  private handDur = 1;
  private readonly fromEye = new Vector3();
  private readonly fromLook = new Vector3();
  private fromFov = 40;
  private blend = 0;
  done = false;
  private tmpE = new Vector3();
  private tmpL = new Vector3();

  constructor(private readonly shots: Shot[]) {
    if (shots.length === 0) this.done = true;
    else this.pose();
  }

  get caption(): IntroCaption | null {
    if (this.done) return null;
    const s = this.shots[Math.min(this.index, this.shots.length - 1)]!;
    return { shot: this.index, kind: s.kind, title: s.title, sub: s.sub, out: this.handT >= 0 };
  }

  /** 1 during the shots, easing to 0 over the hand-over (fog and other intro-only tweaks). */
  get weight(): number {
    return this.done ? 0 : 1 - this.blend;
  }

  /** Jump to the hand-over from wherever the camera is now (ignored for the first moments). */
  skip(): boolean {
    if (this.done || this.handT >= 0 || this.elapsed < tunables.get<number>('intro.skipGuard')) return false;
    this.startHandoff(tunables.get<number>('intro.skipHandoff'));
    return true;
  }

  advance(dt: number): void {
    if (this.done) return;
    this.elapsed += dt;
    if (this.handT >= 0) {
      this.handT += dt;
      this.blend = easeInOut(this.handT / this.handDur);
      if (this.handT >= this.handDur) this.done = true;
      return;
    }
    this.t += dt;
    while (this.index < this.shots.length && this.t >= this.shots[this.index]!.duration) {
      this.t -= this.shots[this.index]!.duration;
      this.index++;
    }
    if (this.index >= this.shots.length) {
      this.index = this.shots.length - 1;
      this.t = this.shots[this.index]!.duration;
      this.pose();
      this.startHandoff(tunables.get<number>('intro.handoff'));
      return;
    }
    this.pose();
  }

  /** Put a camera on the intro pose, blended towards its race pose during the hand-over. */
  apply(camera: PerspectiveCamera, raceLook: Readonly<Vector3>): void {
    let fov = this.fov;
    const e = this.tmpE.copy(this.eye);
    const l = this.tmpL.copy(this.look);
    if (this.handT >= 0) {
      // The race camera already sits on its pose (it keeps updating underneath the intro).
      e.copy(this.fromEye).lerp(camera.position, this.blend);
      l.copy(this.fromLook).lerp(raceLook, this.blend);
      fov = this.fromFov + (camera.fov - this.fromFov) * this.blend;
    }
    camera.position.copy(e);
    camera.lookAt(l);
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  /** Point the world should centre on (shadow map, rain). */
  get focus(): Vector3 {
    return this.handT >= 0 ? this.fromLook : this.look;
  }

  private pose(): void {
    const s = this.shots[this.index]!;
    const u = s.duration > 0 ? Math.min(1, this.t / s.duration) : 1;
    s.eye(u, this.eye);
    s.look(u, this.look);
    this.fov = s.fov(u);
  }

  private startHandoff(duration: number): void {
    this.fromEye.copy(this.eye);
    this.fromLook.copy(this.look);
    this.fromFov = this.fov;
    this.handT = 0;
    this.handDur = Math.max(0.05, duration);
    this.blend = 0;
  }
}
