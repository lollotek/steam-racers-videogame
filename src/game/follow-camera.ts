import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { tunables } from '../core/tunables';

/**
 * Player camera with two modes (doc 01 D2, doc 03 §9):
 * - `board` (default): fixed-orientation, near-isometric view from a high side angle, like looking
 *   down at a tabletop game board (engine refs 1, 2, 5, 6). The view does not spin with the car.
 * - `chase`: high 3/4 camera rotating with the player.
 * Switching modes blends smoothly (yaw, pitch, distance and FOV are all damped).
 */
export type CameraMode = 'board' | 'chase';

tunables.registerGroup('camera', [
  { key: 'camera.mode', type: 'option', default: 'board', options: ['board', 'chase'], label: 'Mode' },
  { key: 'camera.blendHalfLife', type: 'number', default: 0.25, min: 0.01, max: 2, step: 0.01, unit: 's', label: 'Mode blend half-life' },
  { key: 'camera.posHalfLife', type: 'number', default: 0.12, min: 0.01, max: 1, step: 0.01, unit: 's', label: 'Position half-life' },
  // Chase mode.
  { key: 'camera.fov', type: 'number', default: 30, min: 10, max: 70, step: 1, unit: '°', label: 'Chase FOV' },
  { key: 'camera.pitch', type: 'number', default: 52, min: 20, max: 89, step: 1, unit: '°', label: 'Chase pitch' },
  { key: 'camera.distance', type: 'number', default: 58, min: 10, max: 200, step: 1, unit: 'm', label: 'Chase distance (× vehicle scale)' },
  { key: 'camera.distanceAtSpeed', type: 'number', default: 70, min: 10, max: 240, step: 1, unit: 'm', label: 'Chase distance at max speed' },
  { key: 'camera.lookAhead', type: 'number', default: 12, min: 0, max: 30, step: 0.5, unit: 'm', label: 'Chase look-ahead' },
  { key: 'camera.yawHalfLife', type: 'number', default: 0.35, min: 0.02, max: 2, step: 0.01, unit: 's', label: 'Chase yaw half-life' },
  // Board mode.
  { key: 'camera.board.fov', type: 'number', default: 20, min: 5, max: 60, step: 1, unit: '°', label: 'Board FOV' },
  { key: 'camera.board.pitch', type: 'number', default: 47, min: 20, max: 89, step: 1, unit: '°', label: 'Board pitch' },
  { key: 'camera.board.azimuth', type: 'number', default: 35, min: -180, max: 180, step: 1, unit: '°', label: 'Board azimuth' },
  { key: 'camera.board.follow', type: 'number', default: 0, min: 0, max: 1, step: 0.05, label: 'Board yaw follow (0 = fixed)' },
  { key: 'camera.board.followHalfLife', type: 'number', default: 2.5, min: 0.1, max: 10, step: 0.1, unit: 's', label: 'Board yaw follow half-life' },
  { key: 'camera.board.distance', type: 'number', default: 92, min: 10, max: 300, step: 1, unit: 'm', label: 'Board distance (× vehicle scale)' },
  { key: 'camera.board.distanceAtSpeed', type: 'number', default: 104, min: 10, max: 320, step: 1, unit: 'm', label: 'Board distance at max speed' },
  { key: 'camera.board.lookAhead', type: 'number', default: 14, min: 0, max: 40, step: 0.5, unit: 'm', label: 'Board look-ahead' },
]);

export interface CameraTarget {
  /** Road height under the target (elevated tracks); default 0. */
  y?: number;
  x: number;
  z: number;
  heading: number;
  /** 0..1 */
  speedFrac: number;
}

const DEG = Math.PI / 180;

export class FollowCamera {
  readonly camera: PerspectiveCamera;
  /** Chase yaw, tracking the target heading. */
  private chaseYaw = 0;
  /** Board yaw follow offset, slowly tracking the heading (only used when board.follow > 0). */
  private boardHeading = 0;
  /** Smoothed view parameters actually applied (blend between modes). */
  private yaw = 0;
  private pitch = 0;
  private dist = 0;
  private fov = 0;
  private focus = new Vector3();
  private initialized = false;
  /** Screen shake "trauma" 0..1; the shake is its square, so small hits stay subtle. */
  private trauma = 0;
  private shakeTime = 0;

  /**
   * @param zoom vehicle size factor (`?vscale`): distances and look-ahead are the tunables × zoom,
   * so the vehicles keep their size on screen whatever their scale.
   */
  constructor(aspect: number, private readonly zoom = 1) {
    this.camera = new PerspectiveCamera(tunables.get('camera.fov'), aspect, 2, 1000);
  }

  get mode(): CameraMode {
    return tunables.get<string>('camera.mode') === 'chase' ? 'chase' : 'board';
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Add an impact to the shake (tunables group `feedback`). */
  addShake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Sustained shake (scraping): raises the trauma to at least `amount`. */
  holdShake(amount: number): void {
    this.trauma = Math.min(1, Math.max(this.trauma, amount));
  }

  update(target: CameraTarget, dt: number): void {
    const t = (k: string) => tunables.get(k);
    const board = this.mode === 'board';
    const p = board ? 'camera.board.' : 'camera.';

    const fx = Math.sin(target.heading);
    const fz = Math.cos(target.heading);
    const ahead = t(`${p}lookAhead`) * this.zoom * target.speedFrac;
    const goalX = target.x + fx * ahead;
    const goalZ = target.z + fz * ahead;
    const goalY = target.y ?? 0;

    // Desired view for the active mode.
    const azimuth = t('camera.board.azimuth') * DEG;
    if (!this.initialized) {
      this.chaseYaw = target.heading;
      this.boardHeading = target.heading;
    } else {
      this.chaseYaw = dampAngle(this.chaseYaw, target.heading, t('camera.yawHalfLife'), dt);
      this.boardHeading = dampAngle(this.boardHeading, target.heading, t('camera.board.followHalfLife'), dt);
    }
    const boardYaw = azimuth + t('camera.board.follow') * this.boardHeading; // boardHeading is unwrapped → no jumps
    const goalYaw = board ? boardYaw : this.chaseYaw;
    const goalPitch = t(`${p}pitch`) * DEG;
    const goalDist = (t(`${p}distance`) + (t(`${p}distanceAtSpeed`) - t(`${p}distance`)) * target.speedFrac) * this.zoom;
    const goalFov = t(`${p}fov`);

    if (!this.initialized) {
      this.focus.set(goalX, goalY, goalZ);
      this.yaw = goalYaw;
      this.pitch = goalPitch;
      this.dist = goalDist;
      this.fov = goalFov;
      this.initialized = true;
    } else {
      const k = damp(t('camera.posHalfLife'), dt);
      this.focus.x += (goalX - this.focus.x) * k;
      this.focus.z += (goalZ - this.focus.z) * k;
      this.focus.y += (goalY - this.focus.y) * damp(t('camera.posHalfLife') * 3, dt);
      const hl = t('camera.blendHalfLife');
      // In chase mode chaseYaw is already damped; only blend extra when coming from the board view.
      this.yaw = board ? dampAngle(this.yaw, goalYaw, hl, dt) : dampAngle(this.yaw, goalYaw, hl * 0.5, dt);
      const kb = damp(hl, dt);
      this.pitch += (goalPitch - this.pitch) * kb;
      this.dist += (goalDist - this.dist) * kb;
      this.fov += (goalFov - this.fov) * kb;
    }

    if (Math.abs(this.camera.fov - this.fov) > 1e-3) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    const back = Math.cos(this.pitch) * this.dist;
    this.camera.position.set(
      this.focus.x - Math.sin(this.yaw) * back,
      this.focus.y + Math.sin(this.pitch) * this.dist,
      this.focus.z - Math.cos(this.yaw) * back,
    );
    this.camera.lookAt(this.focus);

    if (this.trauma > 0) {
      const on = tunables.get<boolean>('feedback.shake');
      const s = on ? this.trauma * this.trauma : 0;
      this.shakeTime += dt * t('feedback.shakeFrequency');
      const a = t('feedback.shakeAmplitude') * s;
      const w = this.shakeTime * Math.PI * 2;
      // Incommensurate sines: cheap, smooth and never visibly periodic.
      this.camera.translateX(a * (Math.sin(w) * 0.6 + Math.sin(w * 2.31 + 1.7) * 0.4));
      this.camera.translateY(a * (Math.sin(w * 1.37 + 0.6) * 0.6 + Math.sin(w * 2.93 + 4.1) * 0.4));
      this.camera.rotateZ(((t('feedback.shakeRoll') * Math.PI) / 180) * s * Math.sin(w * 0.83 + 2.2));
      this.trauma = Math.max(0, this.trauma - t('feedback.shakeDecay') * dt);
    }
  }
}

/** Fraction to move this frame for a given half-life (frame-rate independent). */
export function damp(halfLife: number, dt: number): number {
  return 1 - Math.pow(2, -dt / Math.max(1e-4, halfLife));
}

export function wrapAngle(a: number): number {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function dampAngle(current: number, target: number, halfLife: number, dt: number): number {
  return current + wrapAngle(target - current) * damp(halfLife, dt);
}
