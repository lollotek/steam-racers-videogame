/**
 * Helpers shared by the Cup worlds (doc 04 §3 C): instanced batching of hand-placed props,
 * placement along the track, crowds, glow pools and painted canvas textures. Everything is
 * primitives + procedural textures (G6); real kits replace it later.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  SphereGeometry,
  Vector3,
  type Material,
  type Scene,
  type Texture,
} from 'three/webgpu';
import { float, smoothstep, uv, vec4 } from 'three/tsl';
import { tunables } from '../core/tunables';
import type { InkLitMaterial } from '../render/ink/ink-material';
import type { WorldContext } from '../world/biome';
import { viewHeightLimit } from '../world/kit';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** Local transform: position, Euler rotation, scale. */
export const T = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(sx, sy, sz));

/** World placement: position + yaw. */
export const W = (x: number, y: number, z: number, yaw = 0, s = 1) => new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw), new Vector3(s, s, s));

/**
 * Collects (geometry, material, matrix) parts and builds one InstancedMesh per pair, so a world
 * made of hundreds of hand-placed pieces costs a few dozen draw calls.
 */
export class Batch {
  private map = new Map<string, { geo: BufferGeometry; mat: Material; list: Matrix4[]; shadow: boolean }>();

  add(geo: BufferGeometry, mat: Material, m: Matrix4, shadow = true): void {
    const key = `${geo.uuid}|${mat.uuid}`;
    let b = this.map.get(key);
    if (!b) this.map.set(key, (b = { geo, mat, list: [], shadow }));
    b.list.push(m);
  }

  /** Add a part in the frame of `world` (part matrix applied first). */
  part(world: Matrix4, geo: BufferGeometry, mat: Material, local: Matrix4, shadow = true): void {
    this.add(geo, mat, world.clone().multiply(local), shadow);
  }

  flush(scene: Scene): number {
    let n = 0;
    for (const b of this.map.values()) {
      if (!b.list.length) continue;
      const mesh = new InstancedMesh(b.geo, b.mat, b.list.length);
      b.list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.castShadow = b.shadow;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      scene.add(mesh);
      n += b.list.length;
    }
    this.map.clear();
    return n;
  }
}

/** Yaw that turns an object's +Z towards the track point at curve parameter t. */
export function yawToTrack(ctx: WorldContext, t: number, x: number, z: number): number {
  const c = ctx.curve.getPointAt(((t % 1) + 1) % 1);
  return Math.atan2(c.x - x, c.z - z);
}

/** Curve parameter ranges [t0, t1] of the pieces tagged with a dressing zone (doc 04 A2). */
export function zoneRanges(ctx: WorldContext, zone: string): [number, number][] {
  const { track } = ctx;
  const out: [number, number][] = [];
  let start = -1;
  const n = track.samples.length;
  for (let i = 0; i <= n; i++) {
    const smp = track.samples[i % n]!;
    const inZone = i < n && track.file.pieces[smp.piece]?.zone === zone;
    if (inZone && start < 0) start = i;
    if (!inZone && start >= 0) {
      out.push([track.samples[start]!.s / track.length, track.samples[i - 1]!.s / track.length]);
      start = -1;
    }
  }
  return out;
}

export const inZones = (ranges: [number, number][], t: number) => ranges.some(([a, b]) => t >= a && t <= b);

/**
 * Spots every `step` metres beside the track at `off` metres (+ = left), both sides when `side`
 * is 0, skipping spots that are not clear of the road or of reserved footprints.
 */
export function alongTrack(
  ctx: WorldContext,
  o: { step: number; off: number; side?: -1 | 0 | 1; extra?: number; radius?: number; t0?: number; t1?: number; where?: (t: number) => boolean },
  fn: (p: Vector3, yaw: number, t: number, side: number) => void,
): void {
  const len = ctx.track.length;
  const t0 = o.t0 ?? 0;
  const t1 = o.t1 ?? 1;
  const count = Math.max(1, Math.floor(((t1 - t0) * len) / o.step));
  const r = o.radius ?? 1;
  for (let i = 0; i < count; i++) {
    const t = t0 + ((i + 0.5) / count) * (t1 - t0);
    if (o.where && !o.where(t)) continue;
    for (const side of o.side ? [o.side] : [1, -1]) {
      const p = besideExact(ctx, t, side * o.off);
      // Clear of every part of the road (curves fold the offsets), with `extra` metres to spare.
      if (ctx.distToTrack(p.x, p.z) < Math.max(o.off - 1.5, ctx.track.halfWidth + r + (o.extra ?? 0.5))) continue;
      if (!isFree(ctx, p.x, p.z, r)) continue;
      ctx.reserved.push({ x: p.x, z: p.z, r });
      fn(p, yawToTrack(ctx, t, p.x, p.z), t, side);
    }
  }
}

/** Point `off` metres beside the centre line (+ = left) at ground height, no clearance search. */
export function besideExact(ctx: WorldContext, t: number, off: number): Vector3 {
  const tt = ((t % 1) + 1) % 1;
  const p = ctx.curve.getPointAt(tt);
  const tan = ctx.curve.getTangentAt(tt);
  // Same convention as the world builder: left = up × tangent.
  const left = new Vector3(tan.z, 0, -tan.x).normalize();
  p.addScaledVector(left, off);
  p.y = ctx.heightAt(p.x, p.z);
  return p;
}

/** Nearest centre-line sample to a point. */
export function nearestSample(ctx: WorldContext, x: number, z: number) {
  let best = ctx.track.samples[0]!;
  let bd = Infinity;
  for (const s of ctx.track.samples) {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** Height limit for a prop at (x, z) so it never hides the road from the board camera (kit.ts). */
export function heightLimit(ctx: WorldContext, x: number, z: number, inset = 0): number {
  return viewHeightLimit(ctx.track, x, z, inset, tunables.get<number>('camera.board.azimuth'), tunables.get<number>('camera.board.pitch'));
}

export const isFree = (ctx: WorldContext, x: number, z: number, r: number) => ctx.reserved.every((o) => (o.x - x) ** 2 + (o.z - z) ** 2 > (o.r + r) ** 2);

/** Points on a ring around the track bounds (vault walls, crater rim, mountains). */
export function ringAround(ctx: WorldContext, extra: number, count: number): { x: number; z: number; a: number; r: number }[] {
  const b = ctx.track.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const r = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + extra;
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, a, r };
  });
}

/** Simple crowd: body + head per figure, scattered in a w × d box in the frame of `world`. */
export function crowd(batch: Batch, world: Matrix4, n: number, w: number, d: number, y: number, bodies: InkLitMaterial[], head: InkLitMaterial, rng: { next(): number }, scale = 1): void {
  for (let i = 0; i < n; i++) {
    const x = (rng.next() - 0.5) * w;
    const z = (rng.next() - 0.5) * d;
    const s = scale * (0.9 + rng.next() * 0.25);
    batch.part(world, CROWD.body, bodies[i % bodies.length]!, T(x, y + 0.65 * s, z, 0, 0, 0, s));
    batch.part(world, CROWD.head, head, T(x, y + 1.5 * s, z, 0, 0, 0, s));
  }
}
const CROWD = { body: new CylinderGeometry(0.32, 0.42, 1.3, 7), head: new SphereGeometry(0.28, 7, 5) };

/** Additive glow discs on the ground (light pools of lamps, runes, mushrooms): one draw call. */
export function glowPools(scene: Scene, pools: { x: number; y: number; z: number; r: number }[], color: string, strength = 0.22): void {
  if (!pools.length) return;
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  const d: N = uv().sub(0.5).length().mul(2);
  m.colorNode = vec4(new Color(color), smoothstep(float(1), float(0), d).pow(2).mul(strength)) as N;
  (m as N).fog = false;
  const geo = new PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new InstancedMesh(geo, m, pools.length);
  pools.forEach((p, i) => mesh.setMatrixAt(i, T(p.x, p.y + 0.07, p.z, 0, 0, 0, p.r * 2, 1, p.r * 2)));
  mesh.renderOrder = 5;
  scene.add(mesh);
}

/** Additive translucent material (holograms, light shafts, glow cards). */
export function glowMaterial(color: string, opacity: number, map?: Texture): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, color: new Color(color), map: map ?? null });
  m.opacity = opacity;
  (m as N).fog = false;
  return m;
}

/** Paint a canvas texture (emblems, windows, runes, clock faces). */
export function paint(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  draw(ctx);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
