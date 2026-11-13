import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { tunables } from '../core/tunables';

/** High 3/4 camera rotating with the player (doc 01 D2, doc 03 §9). */
tunables.registerGroup('camera', [
  { key: 'camera.fov', type: 'number', default: 30, min: 10, max: 70, step: 1, unit: '°', label: 'FOV' },
  { key: 'camera.pitch', type: 'number', default: 52, min: 20, max: 89, step: 1, unit: '°', label: 'Pitch' },
  { key: 'camera.distance', type: 'number', default: 58, min: 10, max: 200, step: 1, unit: 'm', label: 'Distance' },
  { key: 'camera.distanceAtSpeed', type: 'number', default: 70, min: 10, max: 240, step: 1, unit: 'm', label: 'Distance at max speed' },
  { key: 'camera.lookAhead', type: 'number', default: 12, min: 0, max: 30, step: 0.5, unit: 'm', label: 'Look-ahead' },
  { key: 'camera.yawHalfLife', type: 'number', default: 0.35, min: 0.02, max: 2, step: 0.01, unit: 's', label: 'Yaw half-life' },
  { key: 'camera.posHalfLife', type: 'number', default: 0.12, min: 0.01, max: 1, step: 0.01, unit: 's', label: 'Position half-life' },
]);

export interface CameraTarget {
  x: number;
  z: number;
  heading: number;
  /** 0..1 */
  speedFrac: number;
}

export class FollowCamera {
  readonly camera: PerspectiveCamera;
  private yaw = 0;
  private focus = new Vector3();
  private initialized = false;
  /** Screen shake "trauma" 0..1; the shake is its square, so small hits stay subtle. */
  private trauma = 0;
  private shakeTime = 0;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(tunables.get('camera.fov'), aspect, 2, 800);
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
    const fov = t('camera.fov');
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    const fx = Math.sin(target.heading);
    const fz = Math.cos(target.heading);
    const ahead = t('camera.lookAhead') * target.speedFrac;
    const goalX = target.x + fx * ahead;
    const goalZ = target.z + fz * ahead;

    if (!this.initialized) {
      this.yaw = target.heading;
      this.focus.set(goalX, 0, goalZ);
      this.initialized = true;
    } else {
      this.yaw = dampAngle(this.yaw, target.heading, t('camera.yawHalfLife'), dt);
      const k = damp(t('camera.posHalfLife'), dt);
      this.focus.x += (goalX - this.focus.x) * k;
      this.focus.z += (goalZ - this.focus.z) * k;
    }

    const dist = t('camera.distance') + (t('camera.distanceAtSpeed') - t('camera.distance')) * target.speedFrac;
    const pitch = (t('camera.pitch') * Math.PI) / 180;
    const back = Math.cos(pitch) * dist;
    this.camera.position.set(
      this.focus.x - Math.sin(this.yaw) * back,
      Math.sin(pitch) * dist,
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

export function dampAngle(current: number, target: number, halfLife: number, dt: number): number {
  let delta = (target - current) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * damp(halfLife, dt);
}
