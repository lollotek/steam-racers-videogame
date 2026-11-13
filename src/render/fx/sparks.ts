/**
 * Impact sparks in the ink-comic style (doc 02 §9): short hand-drawn strokes in warm colors,
 * hard-edged and tapered like a pen flick, redrawn "on twos" instead of moving smoothly.
 * CPU-simulated, one instanced mesh, no outlines (they never touch the normal/meta buffers).
 */
import {
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  type Camera,
  type Scene,
} from 'three/webgpu';
import { float, instancedBufferAttribute, mix, mrt, step, uniform, uv, vec3, vec4 } from 'three/tsl';
import { Rng } from '../../core/rng';
import { tunables } from '../../core/tunables';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

tunables.registerGroup('feedback', [
  { key: 'feedback.sparks', type: 'boolean', default: true, label: 'Sparks' },
  { key: 'feedback.sparkRate', type: 'number', default: 110, min: 0, max: 400, step: 5, unit: '1/s', label: 'Sparks: scrape rate at max speed' },
  { key: 'feedback.sparkPerHit', type: 'number', default: 2.5, min: 0, max: 10, step: 0.1, label: 'Sparks: count per m/s of impact' },
  { key: 'feedback.sparkSpeed', type: 'number', default: 11, min: 1, max: 40, step: 0.5, unit: 'm/s', label: 'Sparks: speed' },
  { key: 'feedback.sparkLife', type: 'number', default: 0.38, min: 0.05, max: 2, step: 0.01, unit: 's', label: 'Sparks: life' },
  { key: 'feedback.sparkLength', type: 'number', default: 1.5, min: 0.1, max: 6, step: 0.05, unit: 'm', label: 'Sparks: stroke length' },
  { key: 'feedback.sparkWidth', type: 'number', default: 0.16, min: 0.02, max: 1, step: 0.01, unit: 'm', label: 'Sparks: stroke width' },
  { key: 'feedback.sparkGlow', type: 'number', default: 3, min: 0.5, max: 12, step: 0.1, label: 'Sparks: brightness (bloom)' },
  { key: 'feedback.sparkRedraw', type: 'number', default: 18, min: 0, max: 60, step: 1, unit: 'fps', label: 'Sparks: redraw rate (0 = smooth)' },
  { key: 'feedback.shake', type: 'boolean', default: true, label: 'Screen shake' },
  { key: 'feedback.shakeScrape', type: 'number', default: 0.22, min: 0, max: 1, step: 0.01, label: 'Shake: scraping (at max speed)' },
  { key: 'feedback.shakeHit', type: 'number', default: 0.06, min: 0, max: 0.5, step: 0.005, label: 'Shake: edge hit (per m/s)' },
  { key: 'feedback.shakeCrash', type: 'number', default: 1, min: 0, max: 1, step: 0.01, label: 'Shake: crash' },
  { key: 'feedback.shakeVehicle', type: 'number', default: 0.07, min: 0, max: 0.5, step: 0.005, label: 'Shake: vehicle impact (per m/s)' },
  { key: 'feedback.shakeAmplitude', type: 'number', default: 1.6, min: 0, max: 8, step: 0.05, unit: 'm', label: 'Shake: amplitude' },
  { key: 'feedback.shakeRoll', type: 'number', default: 1.2, min: 0, max: 10, step: 0.1, unit: '°', label: 'Shake: roll' },
  { key: 'feedback.shakeFrequency', type: 'number', default: 17, min: 2, max: 60, step: 1, unit: 'Hz', label: 'Shake: frequency' },
  { key: 'feedback.shakeDecay', type: 'number', default: 2.4, min: 0.2, max: 10, step: 0.1, unit: '1/s', label: 'Shake: decay' },
]);

const MAX = 512;
const GRAVITY = 22;
/** HDR multiplier: sparks are the brightest strokes on screen and feed the bloom. */
const glow = uniform(3);

export class SparkSystem {
  readonly mesh: InstancedMesh;
  private rng: Rng;
  private px = new Float32Array(MAX);
  private py = new Float32Array(MAX);
  private pz = new Float32Array(MAX);
  private vx = new Float32Array(MAX);
  private vy = new Float32Array(MAX);
  private vz = new Float32Array(MAX);
  private age = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private heat = new Float32Array(MAX);
  private alive = 0;
  private redraw = 0;
  /** Per instance: heat (0 = ember red … 1 = white hot), fade. */
  private dataAttr = new InstancedBufferAttribute(new Float32Array(MAX * 2), 2);

  constructor(scene: Scene, seed: number) {
    this.rng = new Rng(seed);
    const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
    const data: N = instancedBufferAttribute(this.dataAttr);
    const u: N = uv().x; // 0 = tail, 1 = head
    const across: N = uv().y.sub(0.5).abs().mul(2);
    // Pen flick: full width at the head, tapering to nothing at the tail; hard edge, no gradient.
    const inside: N = step(across, u.pow(0.7));
    const ember: N = vec3(0.86, 0.2, 0.06);
    const hot: N = vec3(1.0, 0.62, 0.16);
    const white: N = vec3(1.0, 0.93, 0.7);
    const warm: N = mix(mix(ember, hot, data.x), white, u.mul(data.x).pow(2));
    // Dying strokes break up into dashes, like a line running out of ink.
    const dash: N = step(float(1).sub(data.y).mul(0.9), u.mul(7).fract().add(u.mul(0.6)));
    mat.colorNode = vec4(warm.mul(glow), inside.mul(dash));
    (mat as N).fog = false;
    (mat as N).mrtNode = mrt({ normal: vec4(0, 0, 0, 0), meta: vec4(0, 0, 0, 0) });
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    this.mesh.instanceMatrix.array.fill(0);
    this.mesh.count = 1; // one degenerate instance keeps the material compiled from the warm-up on
    scene.add(this.mesh);
  }

  /**
   * Throw `count` sparks from a point. (nx, nz) is the normal away from the obstacle and
   * (dx, dz) the travel direction of the vehicle (sparks trail behind it).
   */
  burst(x: number, y: number, z: number, nx: number, nz: number, dx: number, dz: number, count: number, energy = 1): void {
    if (!tunables.get<boolean>('feedback.sparks')) return;
    const r = this.rng;
    const speed = tunables.get('feedback.sparkSpeed') * energy;
    const life = tunables.get('feedback.sparkLife');
    for (let k = 0; k < count && this.alive < MAX; k++) {
      const i = this.alive++;
      this.px[i] = x + r.range(-0.3, 0.3);
      this.py[i] = y + r.range(-0.3, 0.4);
      this.pz[i] = z + r.range(-0.3, 0.3);
      const out = r.range(0.25, 1);
      const back = r.range(0.2, 0.9);
      const s = speed * r.range(0.45, 1.2);
      this.vx[i] = (nx * out - dx * back + r.range(-0.35, 0.35)) * s;
      this.vz[i] = (nz * out - dz * back + r.range(-0.35, 0.35)) * s;
      this.vy[i] = r.range(0.15, 0.9) * s;
      this.age[i] = 0;
      this.life[i] = life * r.range(0.5, 1.4);
      this.size[i] = r.range(0.55, 1.3);
      this.heat[i] = r.range(0.25, 1);
    }
  }

  update(dt: number, camera: Camera): void {
    for (let i = 0; i < this.alive; ) {
      this.age[i]! += dt;
      if (this.age[i]! >= this.life[i]! || this.py[i]! < 0) {
        this.swap(i, --this.alive);
        continue;
      }
      this.vy[i]! -= GRAVITY * dt;
      const drag = Math.exp(-2.2 * dt);
      this.vx[i]! *= drag;
      this.vz[i]! *= drag;
      this.px[i]! += this.vx[i]! * dt;
      this.py[i]! += this.vy[i]! * dt;
      this.pz[i]! += this.vz[i]! * dt;
      i++;
    }
    // Redraw on a fixed cadence: strokes jump between poses like hand-drawn frames.
    const fps = tunables.get('feedback.sparkRedraw');
    this.redraw += dt;
    if (fps > 0 && this.redraw < 1 / fps && this.mesh.count === Math.max(1, this.alive)) return;
    this.redraw = 0;

    const m = this.mesh.instanceMatrix.array as Float32Array;
    const d = this.dataAttr.array as Float32Array;
    const cp = camera.position;
    const len = tunables.get('feedback.sparkLength');
    const width = tunables.get('feedback.sparkWidth');
    const n = this.alive;
    for (let i = 0; i < n; i++) {
      const t = this.age[i]! / this.life[i]!;
      // Stroke axis: along the velocity.
      let ax = this.vx[i]!;
      let ay = this.vy[i]!;
      let az = this.vz[i]!;
      const sp = Math.hypot(ax, ay, az) || 1;
      ax /= sp;
      ay /= sp;
      az /= sp;
      // Width axis: perpendicular to the stroke, facing the camera.
      const cx = cp.x - this.px[i]!;
      const cy = cp.y - this.py[i]!;
      const cz = cp.z - this.pz[i]!;
      let wx = ay * cz - az * cy;
      let wy = az * cx - ax * cz;
      let wz = ax * cy - ay * cx;
      const wl = Math.hypot(wx, wy, wz) || 1;
      wx /= wl;
      wy /= wl;
      wz /= wl;
      const L = len * this.size[i]! * Math.min(1, 0.35 + sp / 14) * (1 - 0.5 * t);
      const W = width * this.size[i]!;
      const o = i * 16;
      m[o] = ax * L;
      m[o + 1] = ay * L;
      m[o + 2] = az * L;
      m[o + 3] = 0;
      m[o + 4] = wx * W;
      m[o + 5] = wy * W;
      m[o + 6] = wz * W;
      m[o + 7] = 0;
      m[o + 8] = ay * wz - az * wy;
      m[o + 9] = az * wx - ax * wz;
      m[o + 10] = ax * wy - ay * wx;
      m[o + 11] = 0;
      // Head at the particle position, tail behind it.
      m[o + 12] = this.px[i]! - ax * L * 0.5;
      m[o + 13] = this.py[i]! - ay * L * 0.5;
      m[o + 14] = this.pz[i]! - az * L * 0.5;
      m[o + 15] = 1;
      d[i * 2] = this.heat[i]! * (1 - 0.6 * t);
      d[i * 2 + 1] = 1 - t;
    }
    if (n === 0) m.fill(0, 0, 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.dataAttr.needsUpdate = true;
    this.mesh.count = Math.max(1, n);
    glow.value = tunables.get('feedback.sparkGlow');
  }

  get count(): number {
    return this.alive;
  }

  private swap(a: number, b: number): void {
    this.px[a] = this.px[b]!;
    this.py[a] = this.py[b]!;
    this.pz[a] = this.pz[b]!;
    this.vx[a] = this.vx[b]!;
    this.vy[a] = this.vy[b]!;
    this.vz[a] = this.vz[b]!;
    this.age[a] = this.age[b]!;
    this.life[a] = this.life[b]!;
    this.size[a] = this.size[b]!;
    this.heat[a] = this.heat[b]!;
  }
}
