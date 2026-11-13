/**
 * Steam / smoke particles (doc 02 §9): CPU-simulated, GPU-instanced sprites with an ink-rimmed
 * puff texture. They never touch the normal/meta buffers, so they get no outlines.
 */
import {
  InstancedBufferAttribute,
  Sprite,
  SpriteNodeMaterial,
  type Camera,
  type Scene,
  type Texture,
} from 'three/webgpu';
import { instancedBufferAttribute, mix, mrt, texture, uv, vec3, vec4 } from 'three/tsl';
import { Rng } from '../../core/rng';
import { tunables } from '../../core/tunables';
import { U } from '../ink/ink-uniforms';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

export type ParticleKind = 'steam' | 'smoke' | 'dust';

export interface EmitterOptions {
  kind: ParticleKind;
  /** Particles per second. */
  rate: number;
  position: { x: number; y: number; z: number };
  /** Initial velocity (m/s) and random spread. */
  velocity?: { x: number; y: number; z: number };
  spread?: number;
  life?: [number, number];
  size?: [number, number];
}

export interface Emitter extends Required<EmitterOptions> {
  acc: number;
  enabled: boolean;
}

tunables.registerGroup('fx', [
  { key: 'fx.particleBudget', type: 'number', default: 1200, min: 0, max: 8000, step: 50, label: 'Particle budget' },
  { key: 'fx.steamOpacity', type: 'number', default: 0.85, min: 0, max: 1, step: 0.01, label: 'Steam opacity' },
  { key: 'fx.smokeOpacity', type: 'number', default: 0.8, min: 0, max: 1, step: 0.01, label: 'Smoke opacity' },
  { key: 'fx.rateScale', type: 'number', default: 1, min: 0, max: 4, step: 0.05, label: 'Emission rate scale' },
  { key: 'fx.wind', type: 'number', default: 1.2, min: 0, max: 8, step: 0.1, unit: 'm/s', label: 'Wind' },
]);

const MAX = 8000;
const KIND_ID: Record<ParticleKind, number> = { steam: 0, smoke: 1, dust: 2 };

export class ParticleSystem {
  readonly sprite: Sprite;
  private emitters: Emitter[] = [];
  private rng: Rng;
  // Simulation state (structure of arrays).
  private px = new Float32Array(MAX);
  private py = new Float32Array(MAX);
  private pz = new Float32Array(MAX);
  private vx = new Float32Array(MAX);
  private vy = new Float32Array(MAX);
  private vz = new Float32Array(MAX);
  private age = new Float32Array(MAX);
  private life = new Float32Array(MAX);
  private s0 = new Float32Array(MAX);
  private s1 = new Float32Array(MAX);
  private rot = new Float32Array(MAX);
  private kind = new Uint8Array(MAX);
  private alive = 0;
  // GPU attributes: position + (size, alpha, rotation, kind).
  private posAttr = new InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  private dataAttr = new InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
  private order = new Uint32Array(MAX);
  private depth = new Float32Array(MAX);

  constructor(scene: Scene, puff: Texture, seed: number) {
    this.rng = new Rng(seed);
    const mat = new SpriteNodeMaterial({ transparent: true, depthWrite: false });
    const pos: N = instancedBufferAttribute(this.posAttr);
    const data: N = instancedBufferAttribute(this.dataAttr);
    mat.positionNode = pos;
    (mat as N).scaleNode = data.x;
    (mat as N).rotationNode = data.z;
    const tex: N = texture(puff).sample(uv());
    // Fake spherical lighting: top of the puff warm/lit, bottom in the biome shadow color.
    const lit: N = mix(U.shadowColor, U.litTint, uv().y.mul(0.8).add(0.2));
    const steam: N = tex.rgb.mul(lit).mul(1.05);
    const smoke: N = mix(U.inkColor, vec3(0.16, 0.13, 0.11), tex.rgb);
    const dust: N = tex.rgb.mul(vec3(0.55, 0.45, 0.35));
    const kindN: N = data.w;
    const rgb: N = kindN.lessThan(0.5).select(steam, kindN.lessThan(1.5).select(smoke, dust));
    mat.colorNode = vec4(rgb, tex.a.mul(data.y));
    // Leave normal/meta untouched: alpha 0 with normal blending keeps the destination (doc 02 §2).
    // The scene pass MRT uses material blending for these attachments (see render/pipeline.ts).
    (mat as N).mrtNode = mrt({ normal: vec4(0, 0, 0, 0), meta: vec4(0, 0, 0, 0) });

    this.sprite = new Sprite(mat);
    (this.sprite as N).count = 0;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 10;
    scene.add(this.sprite);
  }

  addEmitter(o: EmitterOptions): Emitter {
    const e: Emitter = {
      velocity: { x: 0, y: 2, z: 0 },
      spread: 0.6,
      life: [2.5, 4],
      size: [1.2, 4.5],
      ...o,
      acc: 0,
      enabled: true,
    };
    this.emitters.push(e);
    return e;
  }

  /** One-shot puff (impacts): `count` particles with the emitter's settings, no emitter kept. */
  burst(o: EmitterOptions, count: number): void {
    const e: Emitter = { velocity: { x: 0, y: 2, z: 0 }, spread: 0.6, life: [2.5, 4], size: [1.2, 4.5], ...o, acc: 0, enabled: true };
    for (let i = 0; i < count; i++) this.spawn(e);
  }

  private spawn(e: Emitter): void {
    if (this.alive >= Math.min(MAX, tunables.get('fx.particleBudget'))) return;
    const i = this.alive++;
    const r = this.rng;
    const sp = e.spread;
    this.px[i] = e.position.x + r.range(-0.3, 0.3);
    this.py[i] = e.position.y;
    this.pz[i] = e.position.z + r.range(-0.3, 0.3);
    this.vx[i] = e.velocity.x + r.range(-sp, sp);
    this.vy[i] = e.velocity.y + r.range(-sp, sp) * 0.5;
    this.vz[i] = e.velocity.z + r.range(-sp, sp);
    this.age[i] = 0;
    this.life[i] = r.range(e.life[0], e.life[1]);
    this.s0[i] = e.size[0] * r.range(0.8, 1.2);
    this.s1[i] = e.size[1] * r.range(0.8, 1.2);
    this.rot[i] = r.range(0, Math.PI * 2);
    this.kind[i] = KIND_ID[e.kind];
  }

  update(dt: number, camera: Camera): void {
    const rate = tunables.get('fx.rateScale');
    for (const e of this.emitters) {
      if (!e.enabled) continue;
      e.acc += e.rate * rate * dt;
      while (e.acc >= 1) {
        e.acc -= 1;
        this.spawn(e);
      }
    }
    const wind = tunables.get('fx.wind');
    // Integrate and compact dead particles (swap-remove).
    for (let i = 0; i < this.alive; ) {
      this.age[i]! += dt;
      if (this.age[i]! >= this.life[i]!) {
        this.swap(i, --this.alive);
        continue;
      }
      const drag = Math.exp(-0.9 * dt);
      this.vx[i] = this.vx[i]! * drag + wind * 0.6 * dt;
      this.vz[i] = this.vz[i]! * drag + wind * 0.3 * dt;
      this.vy[i] = this.vy[i]! * Math.exp(-0.4 * dt);
      this.px[i]! += this.vx[i]! * dt;
      this.py[i]! += this.vy[i]! * dt;
      this.pz[i]! += this.vz[i]! * dt;
      this.rot[i]! += 0.15 * dt;
      i++;
    }
    // Back-to-front sort for alpha blending.
    const cp = camera.position;
    const n = this.alive;
    for (let i = 0; i < n; i++) {
      this.order[i] = i;
      const dx = this.px[i]! - cp.x, dy = this.py[i]! - cp.y, dz = this.pz[i]! - cp.z;
      this.depth[i] = dx * dx + dy * dy + dz * dz;
    }
    const ord = this.order.subarray(0, n);
    ord.sort((a, b) => this.depth[b]! - this.depth[a]!);

    const pa = this.posAttr.array as Float32Array;
    const da = this.dataAttr.array as Float32Array;
    const opSteam = tunables.get('fx.steamOpacity');
    const opSmoke = tunables.get('fx.smokeOpacity');
    for (let k = 0; k < n; k++) {
      const i = ord[k]!;
      const t = this.age[i]! / this.life[i]!;
      const fadeIn = Math.min(1, t * 6);
      const fadeOut = 1 - t * t;
      const op = this.kind[i] === 1 ? opSmoke : this.kind[i] === 0 ? opSteam : 0.5;
      pa[k * 3] = this.px[i]!;
      pa[k * 3 + 1] = this.py[i]!;
      pa[k * 3 + 2] = this.pz[i]!;
      da[k * 4] = this.s0[i]! + (this.s1[i]! - this.s0[i]!) * Math.sqrt(t);
      da[k * 4 + 1] = fadeIn * fadeOut * op;
      da[k * 4 + 2] = this.rot[i]!;
      da[k * 4 + 3] = this.kind[i]!;
    }
    this.posAttr.needsUpdate = true;
    this.dataAttr.needsUpdate = true;
    (this.sprite as N).count = n;
  }

  /** Draw one invisible particle so the sprite material compiles during warm-up, not at the first puff. */
  prime(): void {
    if (this.alive > 0) return;
    (this.dataAttr.array as Float32Array).fill(0, 0, 4);
    this.dataAttr.needsUpdate = true;
    (this.sprite as N).count = 1;
  }

  get count(): number {
    return this.alive;
  }

  private swap(a: number, b: number): void {
    const arrs = [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.age, this.life, this.s0, this.s1, this.rot] as const;
    for (const arr of arrs) arr[a] = arr[b]!;
    this.kind[a] = this.kind[b]!;
  }
}
