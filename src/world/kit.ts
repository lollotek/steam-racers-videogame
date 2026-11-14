/**
 * Shared building blocks for biome worlds (doc 04 §3 A1): ink materials, painted canvas textures,
 * light pools, molten pools and road ribbons. Moved out of the M1 foundry scene unchanged.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Object3D,
  type Texture,
} from 'three/webgpu';
import { float, fract, instancedBufferAttribute, mix, mrt, positionLocal, smoothstep, texture, time, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { InkLitMaterial } from '../render/ink/ink-material';
import { Rng } from '../core/rng';
import type { CompiledTrack } from '../track/compile';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

export function ink(p: ConstructorParameters<typeof InkLitMaterial>[0]): InkLitMaterial {
  return new InkLitMaterial(p);
}

export function textTexture(lines: string[], bg: string, fg: string, w = 512, h = 256, inkColor = '#1B1210', grime = 'rgba(122,74,46,A)'): Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = inkColor;
  ctx.lineWidth = 14;
  ctx.strokeRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => {
    ctx.font = `900 ${i === 0 ? 96 : 52}px Impact, 'Arial Black', sans-serif`;
    ctx.fillText(l, w / 2, h * (lines.length === 1 ? 0.5 : 0.36 + i * 0.36));
    ctx.lineWidth = 3;
    ctx.strokeText(l, w / 2, h * (lines.length === 1 ? 0.5 : 0.36 + i * 0.36));
  });
  // Drips and grime.
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = grime.replace('A', String(0.2 + Math.random() * 0.3));
    ctx.fillRect(Math.random() * w, Math.random() * h, 3 + Math.random() * 6, 10 + Math.random() * 40);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Neon sign: glowing emblem on black (used as emissive mask). */
export function neonTexture(kind: 'gear' | 'bolt'): Texture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = '#fff';
  ctx.shadowBlur = 12;
  ctx.lineWidth = 9;
  ctx.translate(s / 2, s / 2);
  if (kind === 'gear') {
    const teeth = 10;
    ctx.beginPath();
    for (let i = 0; i <= teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? 100 : 82;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-22, -8, 14, 0, Math.PI * 2);
    ctx.moveTo(36, -8);
    ctx.arc(22, -8, 14, 0, Math.PI * 2);
    ctx.moveTo(-26, 36);
    ctx.lineTo(26, 36);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(20, -100);
    ctx.lineTo(-40, 10);
    ctx.lineTo(10, 10);
    ctx.lineTo(-20, 100);
    ctx.lineTo(50, -20);
    ctx.lineTo(0, -20);
    ctx.closePath();
    ctx.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function checkerTexture(a = '#1B1210', b = '#D8D2C8'): Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  for (let x = 0; x < 16; x++)
    for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? a : b;
      ctx.fillRect(x * 32, y * 32, 32, 32);
    }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Additive glow pool on the ground under a light source (doc 02 §3.4). */
export function lightPool(color: string, radius: number, strength = 0.18): Mesh {
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  const d: N = uv().sub(0.5).length().mul(2);
  m.colorNode = vec4(new Color(color), smoothstep(float(1), float(0), d).pow(2).mul(strength)) as N;
  (m as N).fog = false;
  const pool = new Mesh(new PlaneGeometry(radius * 2, radius * 2), m);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.06;
  pool.renderOrder = 5;
  return pool;
}

/** Molten metal: two scrolling noise layers → dark crust vs glowing HDR lava (doc 02 §10). */
export function lavaMaterial(noise: Texture): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  const n1: N = texture(noise).sample(uv().mul(2.2).add(vec2(time.mul(0.015), time.mul(0.01)))).r;
  const n2: N = texture(noise).sample(uv().mul(3.7).sub(vec2(time.mul(0.012), time.mul(0.02)))).g;
  const n: N = n1.mul(0.6).add(n2.mul(0.4));
  const hot: N = smoothstep(0.42, 0.62, n);
  const crust = vec3(0.05, 0.025, 0.02);
  const lava: N = mix(vec3(2.5, 0.6, 0.08), vec3(5.0, 2.4, 0.6), smoothstep(0.62, 0.85, n));
  m.colorNode = vec4(mix(crust, lava, hot), 1) as N;
  return m;
}

/**
 * Ribbon over `count` consecutive centre-line samples starting at `from` (wraps), following the
 * road heights. u across, v = s / width. `dy` lifts it above the road (decals) or sinks it (pits).
 */
export function ribbonFromSamples(track: CompiledTrack, from: number, count: number, halfWidth: number, dy: number, yOf?: (i: number) => number): BufferGeometry {
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const n = track.samples.length;
  let v = track.samples[from]!.s / (halfWidth * 2);
  for (let k = 0; k < count; k++) {
    const i = (from + k) % n;
    const p = track.samples[i]!;
    if (k > 0) {
      const q = track.samples[(from + k - 1) % n]!;
      v += Math.hypot(p.x - q.x, p.z - q.z) / (halfWidth * 2);
    }
    const y = (yOf ? yOf(i) : p.y) + dy;
    // Left edge first, then right edge (driver's right of the tangent is (-tz, tx)).
    pos.push(p.x + p.tz * halfWidth, y, p.z - p.tx * halfWidth);
    uvs.push(0, v);
    pos.push(p.x - p.tz * halfWidth, y, p.z + p.tx * halfWidth);
    uvs.push(1, v);
    if (k < count - 1) {
      const a = k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Flip the winding if the normals came out facing down.
  const nr = g.getAttribute('normal');
  if (nr.count && nr.getY(0) < 0) {
    const flipped: number[] = [];
    for (let i = 0; i < idx.length; i += 3) flipped.push(idx[i]!, idx[i + 2]!, idx[i + 1]!);
    g.setIndex(flipped);
    g.computeVertexNormals();
  }
  return g;
}

/**
 * Vertical skirt under one road edge (side −1 = left, +1 = right) from the road down `depth`
 * metres: closes elevated roads, kickers and the walls of jump pits.
 */
export function skirtFromSamples(track: CompiledTrack, from: number, count: number, halfWidth: number, side: number, depth: number): BufferGeometry {
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const n = track.samples.length;
  let v = 0;
  for (let k = 0; k < count; k++) {
    const p = track.samples[(from + k) % n]!;
    if (k > 0) {
      const q = track.samples[(from + k - 1) % n]!;
      v += Math.hypot(p.x - q.x, p.z - q.z) / 8;
    }
    const x = p.x - p.tz * halfWidth * side;
    const z = p.z + p.tx * halfWidth * side;
    pos.push(x, p.y + 0.04, z, x, p.y - depth, z);
    uvs.push(v, 0, v, depth / 8);
    if (k < count - 1) {
      const a = k * 2;
      // Faces outwards: winding depends on the side.
      if (side > 0) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Free the GPU resources of a scene (geometries, materials and their own textures) when a race
 * ends (doc 04 B2: one scene per race). Textures in `keep` (the shared procedural set) survive.
 */
export function disposeScene(scene: Object3D, keep: Set<unknown>): void {
  const mats = new Set<Material>();
  const geos = new Set<BufferGeometry>();
  scene.traverse((o) => {
    const m = o as Mesh;
    if (m.geometry) geos.add(m.geometry);
    if (m.material) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mats.add(mat);
    if ((o as InstancedMesh).isInstancedMesh) (o as InstancedMesh).dispose();
  });
  for (const g of geos) g.dispose();
  for (const mat of mats) {
    for (const v of Object.values(mat)) {
      const t = v as Texture | null;
      if (t && typeof t === 'object' && (t as { isTexture?: boolean }).isTexture && !keep.has(t)) t.dispose();
    }
    mat.dispose();
  }
  scene.clear();
}

/**
 * Tallest a prop at (x, z) may be without hiding the road from the board camera (fixed azimuth and
 * pitch, follow-camera.ts): unlimited behind the road (away from the camera), otherwise the height
 * of the sight line over the gap between the prop's front (`inset` metres towards the road) and
 * the road edge. Props beside the road get a looser limit. Uses the nearest centre-line sample.
 */
export function viewHeightLimit(track: CompiledTrack, x: number, z: number, inset = 0, azimuthDeg = 35, pitchDeg = 47): number {
  let s = track.samples[0]!;
  let bd = Infinity;
  for (const q of track.samples) {
    const d = (q.x - x) ** 2 + (q.z - z) ** 2;
    if (d < bd) {
      bd = d;
      s = q;
    }
  }
  const ox = x - s.x;
  const oz = z - s.z;
  const d = Math.hypot(ox, oz);
  if (d < 1e-3) return 0;
  const az = (azimuthDeg * Math.PI) / 180;
  const along = (ox * Math.sin(az) + oz * Math.cos(az)) / d; // +1 = straight behind the road
  if (along > 0.15) return Infinity;
  const gap = Math.max(0, d - inset - track.halfWidth);
  return (gap * Math.tan((pitchDeg * Math.PI) / 180)) / Math.max(0.35, -along);
}

/**
 * Rain streaks in a box around the camera focus (doc 04 §7.2 drizzle, §7.4 rain). Positions are
 * computed on the GPU from a per-drop offset and the clock, wrapped in world space so the drops do
 * not move with the camera. No outlines (normal/meta untouched), no shadows.
 */
export class RainField {
  readonly mesh: InstancedMesh;
  private readonly focus = uniform(new Vector3());
  static readonly SIZE = 70;
  static readonly HEIGHT = 34;

  constructor(scene: { add(o: Object3D): unknown }, o: { color: string; count: number; speed: number }) {
    const geo = new BoxGeometry(0.03, 1.4, 0.03);
    const offsets = new Float32Array(o.count * 3);
    const rng = new Rng(4242);
    for (let i = 0; i < offsets.length; i++) offsets[i] = rng.next();
    const off: N = instancedBufferAttribute(new InstancedBufferAttribute(offsets, 3));
    const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const S = RainField.SIZE;
    const H = RainField.HEIGHT;
    const f: N = this.focus;
    const wrap = (o: N, c: N, size: number) => fract(o.sub(c.div(size))).sub(0.5).mul(size).add(c);
    const x: N = wrap(off.x, f.x, S);
    const z: N = wrap(off.z, f.z, S);
    const y: N = fract(off.y.sub(time.mul(o.speed / H))).mul(H).add(f.y).sub(4);
    // Slight slant with the wind.
    mat.positionNode = positionLocal.add(vec3(x.add(positionLocal.y.mul(0.12)), y, z)) as N;
    mat.colorNode = vec4(new Color(o.color), float(0.35)) as N;
    (mat as N).mrtNode = mrt({ normal: vec4(0, 0, 0, 0), meta: vec4(0, 0, 0, 0) });
    (mat as N).fog = false;
    this.mesh = new InstancedMesh(geo, mat, o.count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    scene.add(this.mesh);
  }

  update(focus: Vector3): void {
    this.focus.value.copy(focus);
  }
}
