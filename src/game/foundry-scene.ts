/**
 * M1 look-test scene: an Iron City steam foundry track section (doc 01 D6, doc 02 §12).
 * Built from primitives + procedural painted textures; real modular kit art replaces it later.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Euler,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  Quaternion,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Texture,
} from 'three/webgpu';
import { float, mix, smoothstep, texture, time, uv, vec2, vec3, vec4 } from 'three/tsl';
import { Rng } from '../core/rng';
import { tunables } from '../core/tunables';
import { InkLitMaterial, heightFogNode } from '../render/ink/ink-material';

import type { ProceduralSet } from '../render/procedural/textures';
import type { EmitterOptions } from '../render/fx/particles';
import { buildDressing, type Reserved } from './dressing';
import { sampleAt, type CompiledTrack } from '../track/compile';
import type { Surface } from '../track/track-format';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

export const TRACK_HALF_WIDTH = 7;

tunables.registerGroup('light', [
  { key: 'light.keyColor', type: 'color', default: '#C9B8A6', label: 'Key light color' },
  { key: 'light.keyIntensity', type: 'number', default: 4.5, min: 0, max: 12, step: 0.05, label: 'Key intensity' },
  { key: 'light.keyPitch', type: 'number', default: 55, min: 10, max: 89, step: 1, unit: '°', label: 'Key pitch' },
  { key: 'light.keyYaw', type: 'number', default: 215, min: 0, max: 360, step: 1, unit: '°', label: 'Key yaw' },
  { key: 'light.skyColor', type: 'color', default: '#4A4440', label: 'Hemisphere sky' },
  { key: 'light.groundColor', type: 'color', default: '#2A1E1A', label: 'Hemisphere ground' },
  { key: 'light.ambient', type: 'number', default: 3.0, min: 0, max: 6, step: 0.05, label: 'Ambient intensity' },
  { key: 'light.furnaceIntensity', type: 'number', default: 600, min: 0, max: 5000, step: 10, label: 'Furnace light intensity' },
  { key: 'light.furnaceRange', type: 'number', default: 24, min: 2, max: 100, step: 1, unit: 'm', label: 'Furnace light range' },
]);

export interface FoundryWorld {
  scene: Scene;
  curve: CatmullRomCurve3;
  trackLength: number;
  keyLight: DirectionalLight;
  emitters: EmitterOptions[];
  /** Point lights that the quality manager may cap. */
  localLights: PointLight[];
  update(dt: number, focus: Vector3): void;
}



function ink(p: ConstructorParameters<typeof InkLitMaterial>[0]): InkLitMaterial {
  return new InkLitMaterial(p);
}

function textTexture(lines: string[], bg: string, fg: string, w = 512, h = 256): Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#1B1210';
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
  // Rust drips and grime.
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(122,74,46,${0.2 + Math.random() * 0.3})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 3 + Math.random() * 6, 10 + Math.random() * 40);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Neon sign: glowing gear-skull-ish emblem on transparent black (used as emissive mask). */
function neonTexture(kind: 'gear' | 'bolt'): Texture {
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

/** Ribbon over `count` consecutive centre-line samples starting at `from` (wraps). u across, v = s / width. */
function ribbonFromSamples(track: CompiledTrack, from: number, count: number, halfWidth: number, y: number): BufferGeometry {
  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const n = track.samples.length;
  let v = track.samples[from]!.s / (halfWidth * 2);
  for (let k = 0; k < count; k++) {
    const p = track.samples[(from + k) % n]!;
    if (k > 0) {
      const q = track.samples[(from + k - 1) % n]!;
      v += Math.hypot(p.x - q.x, p.z - q.z) / (halfWidth * 2);
    }
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

function checkerTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  for (let x = 0; x < 16; x++)
    for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#1B1210' : '#D8D2C8';
      ctx.fillRect(x * 32, y * 32, 32, 32);
    }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Additive glow pool on the ground under a light source (doc 02 §3.4). */
function lightPool(color: string, radius: number): Mesh {
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
  const d: N = uv().sub(0.5).length().mul(2);
  m.colorNode = vec4(new Color(color), smoothstep(float(1), float(0), d).pow(2).mul(0.18)) as N;
  (m as N).fog = false;
  const pool = new Mesh(new PlaneGeometry(radius * 2, radius * 2), m);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.06;
  pool.renderOrder = 5;
  return pool;
}

/** Molten metal: two scrolling noise layers → dark crust vs glowing HDR lava (doc 02 §10). */
function lavaMaterial(noise: Texture): MeshBasicNodeMaterial {
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

export function buildFoundry(tex: ProceduralSet, seed: number, track: CompiledTrack): FoundryWorld {
  const rng = new Rng(seed);
  const scene = new Scene();
  scene.background = new Color(tunables.get<string>('fog.color'));
  (scene as N).fogNode = heightFogNode();
  tunables.onChange((k, v) => {
    if (k === 'fog.color') (scene.background as Color).set(v as string);
  });

  // --- Lights -------------------------------------------------------------------
  const hemi = new HemisphereLight(tunables.get<string>('light.skyColor'), tunables.get<string>('light.groundColor'), tunables.get('light.ambient'));
  scene.add(hemi);
  const key = new DirectionalLight(tunables.get<string>('light.keyColor'), tunables.get('light.keyIntensity'));
  key.castShadow = true;
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.04;
  const sc = key.shadow.camera;
  sc.left = sc.bottom = -75;
  sc.right = sc.top = 75;
  sc.near = 1;
  sc.far = 300;
  scene.add(key, key.target);
  const localLights: PointLight[] = [];
  const syncLights = () => {
    hemi.color.set(tunables.get<string>('light.skyColor'));
    hemi.groundColor.set(tunables.get<string>('light.groundColor'));
    hemi.intensity = tunables.get('light.ambient');
    key.color.set(tunables.get<string>('light.keyColor'));
    key.intensity = tunables.get('light.keyIntensity');
    for (const l of localLights) {
      l.intensity = tunables.get('light.furnaceIntensity');
      l.distance = tunables.get('light.furnaceRange');
    }
  };
  tunables.onChange((k) => k.startsWith('light.') && syncLights());

  // --- Ground & track -------------------------------------------------------------
  const ground = new Mesh(new PlaneGeometry(700, 700), ink({ map: tex.dirt, mapping: 'world', mapScale: 1 / 10, lineWeight: 0.5, color: '#C8B4A4' }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Decoration helper curve through the compiled centre line (props are placed with it).
  const pts: Vector3[] = [];
  for (let i = 0; i < track.samples.length; i += 4) pts.push(new Vector3(track.samples[i]!.x, 0, track.samples[i]!.z));
  const curve = new CatmullRomCurve3(pts, true, 'centripetal');
  const trackLength = track.length;
  const up = new Vector3(0, 1, 0);

  // --- Road surfaces: one ribbon per run of equal surface (doc 03 §7.1). -------------
  const surfaceMats: Record<Surface, InkLitMaterial> = {
    plate: ink({ map: tex.plates, mapping: 'uv', lineWeight: 0.5 }),
    grate: ink({ map: tex.grate, mapping: 'uv', mapScale: 2, lineWeight: 0.5 }),
    dirt: ink({ map: tex.dirt, mapping: 'uv', mapScale: 2, lineWeight: 0.5, color: '#E0CCB8' }),
    sand: ink({ map: tex.dirt, mapping: 'uv', mapScale: 2, lineWeight: 0.5, color: '#F4E0B8' }),
    oil: ink({ map: tex.plates, mapping: 'uv', lineWeight: 0.5, color: '#5A4E48', sheen: 0.6 }),
    water: ink({ map: tex.dirt, mapping: 'uv', mapScale: 2, lineWeight: 0.5, color: '#6A7A80', sheen: 0.9 }),
  };
  const n = track.samples.length;
  let runStart = 0;
  while (runStart < n && track.samples[runStart]!.surface === track.samples[(runStart - 1 + n) % n]!.surface) runStart++;
  if (runStart >= n) runStart = 0;
  for (let k = 0; k < n; ) {
    const i0 = (runStart + k) % n;
    const surf = track.samples[i0]!.surface;
    let len = 1;
    while (k + len < n && track.samples[(runStart + k + len) % n]!.surface === surf) len++;
    const road = new Mesh(ribbonFromSamples(track, i0, len + 1, track.halfWidth, 0.05), surfaceMats[surf]);
    road.receiveShadow = true;
    scene.add(road);
    k += len;
  }

  // Start/finish line: checker strip + gantry at lineS.
  {
    const smp = sampleAt(track, track.lineS);
    const yaw = Math.atan2(smp.tx, smp.tz);
    const line = new Mesh(new PlaneGeometry(track.halfWidth * 2, 2.2), ink({ map: checkerTexture(), mapping: 'uv', hatch: false, lineWeight: 0.5 }));
    line.rotation.set(-Math.PI / 2, 0, yaw);
    line.position.set(smp.x, 0.09, smp.z);
    scene.add(line);
    const gantry = new Group();
    const ironG = ink({ map: tex.iron, mapping: 'world', mapScale: 0.3 });
    for (const side of [-1, 1]) {
      const post = new Mesh(new BoxGeometry(0.8, 8, 0.8), ironG);
      post.position.set(side * (track.halfWidth + 1.5), 4, 0);
      gantry.add(post);
    }
    const beam = new Mesh(new BoxGeometry(track.halfWidth * 2 + 4, 1.4, 1), ink({ map: textTexture(['START'], '#B08A4A', '#1B1210', 1024, 128), mapping: 'uv' }));
    beam.position.set(0, 8, 0);
    gantry.add(beam);
    gantry.position.set(smp.x, 0, smp.z);
    gantry.rotation.y = yaw;
    gantry.traverse((o) => {
      o.castShadow = true;
      o.receiveShadow = true;
    });
    scene.add(gantry);
  }

  // --- Barricades by type (gameplay.md §6.3), instanced. -------------------------------
  const wallGeo = new BoxGeometry(0.5, 1.3, 4.1);
  const wallMat = ink({ map: tex.rust, mapping: 'world', mapScale: 0.35 });
  const corrugatedMat = ink({ map: tex.iron, mapping: 'world', mapScale: 0.6, color: '#C8BEB4' });
  const spikeGeo = new CylinderGeometry(0, 0.16, 1.1, 6);
  const spikeMat = ink({ color: '#6E655E', sheen: 0.4 });
  const tyreGeo = new TorusGeometry(0.55, 0.25, 8, 14);
  tyreGeo.rotateX(Math.PI / 2);
  const tyreMat = ink({ color: '#2A2422' });
  const beamGeo = new BoxGeometry(0.22, 0.22, 2.4);
  const bagGeo = new SphereGeometry(0.5, 10, 6);
  bagGeo.scale(1.1, 0.45, 0.65);
  const bagMat = ink({ map: tex.dirt, mapping: 'world', mapScale: 0.5, color: '#D8C8A8' });
  const bermGeo = new CylinderGeometry(1, 1, 4.3, 10, 1, false, 0, Math.PI);
  bermGeo.rotateX(Math.PI / 2);
  const bermMat = ink({ map: tex.dirt, mapping: 'world', mapScale: 0.3, color: '#C0A890' });
  const postGeo = new BoxGeometry(0.18, 1.6, 0.18);
  const wireGeo = new BoxGeometry(0.04, 0.04, 4.2);
  const postMat = ink({ color: '#5C4A3A' });
  const wireMat = ink({ color: '#8C8078', lineWeight: 0.3 });
  const L: Record<string, Matrix4[]> = { wall: [], corr: [], spike: [], tyre: [], beam: [], bag: [], berm: [], post: [], wire: [] };
  const step = 4.2;
  const steps = Math.floor(trackLength / step);
  const one = new Vector3(1, 1, 1);
  for (let i = 0; i < steps; i++) {
    const d = i * step + step / 2;
    const sp = sampleAt(track, d);
    const smp = track.samples[Math.round(d / track.spacing) % n]!;
    const yaw = Math.atan2(sp.tx, sp.tz);
    const q = new Quaternion().setFromAxisAngle(up, yaw);
    const tight = Math.abs(sp.curvature) > 0.06;
    for (const side of [-1, 1]) {
      const type = side > 0 ? smp.right : smp.left;
      // Driver's right of the tangent: (-tz, tx).
      const ox = -sp.tz * side;
      const oz = sp.tx * side;
      const off = track.halfWidth + 0.7;
      const at = (dd: number, y: number) => new Vector3(sp.x + ox * dd, y, sp.z + oz * dd);
      const M = (pos: Vector3, rot: Quaternion = q) => new Matrix4().compose(pos, rot, one);
      if (tight && (type === 'riveted' || type === 'corrugated')) {
        // Tyre walls in tight corners (refs/engine 3).
        // Behind the contact line of the invisible rail (race/barricades.ts), like every barricade.
        for (let k = 0; k < 3; k++) L.tyre!.push(new Matrix4().makeTranslation(sp.x + ox * (off + 0.5), 0.25 + k * 0.5, sp.z + oz * (off + 0.5)));
        continue;
      }
      switch (type) {
        case 'riveted':
          L.wall!.push(M(at(off, 0.65)));
          if (i % 3 === 0) L.spike!.push(M(at(off, 1.75)));
          break;
        case 'corrugated':
          L.corr!.push(M(at(off, 0.65)));
          break;
        case 'hedgehog':
          L.wall!.push(M(at(off + 0.3, 0.65)));
          if (i % 2 === 0)
            for (const [rx, ry] of [[0.6, 0.6], [-0.6, 0.6], [0, -0.75]] as const) {
              L.beam!.push(M(at(off - 0.6, 0.9), new Quaternion().setFromEuler(new Euler(rx, yaw + ry, 0))));
            }
          break;
        case 'sandbags': {
          const rot = new Quaternion().setFromAxisAngle(up, yaw + Math.PI / 2);
          for (let row = 0; row < 3; row++)
            for (let b = 0; b < 4; b++) {
              const along = -1.6 + b * 1.05 + row * 0.5;
              L.bag!.push(M(new Vector3(sp.x + ox * (off - 0.2) + sp.tx * along, 0.22 + row * 0.42, sp.z + oz * (off - 0.2) + sp.tz * along), rot));
            }
          break;
        }
        case 'earth':
          L.berm!.push(M(at(off + 0.3, 0)));
          break;
        case 'barbed':
          L.post!.push(M(at(off, 0.8)));
          for (const y of [0.6, 1.1, 1.5]) L.wire!.push(M(at(off, y)));
          break;
      }
    }
  }
  const inst = (geo: BufferGeometry, mat: InkLitMaterial, list: Matrix4[]) => {
    if (!list.length) return null;
    const m = new InstancedMesh(geo, mat, list.length);
    list.forEach((mx, i) => m.setMatrixAt(i, mx));
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  inst(wallGeo, wallMat, L.wall!);
  inst(wallGeo, corrugatedMat, L.corr!);
  inst(spikeGeo, spikeMat, L.spike!);
  inst(tyreGeo, tyreMat, L.tyre!);
  inst(beamGeo, spikeMat, L.beam!);
  inst(bagGeo, bagMat, L.bag!);
  inst(bermGeo, bermMat, L.berm!);
  inst(postGeo, postMat, L.post!);
  inst(wireGeo, wireMat, L.wire!);

  // --- Props -------------------------------------------------------------------------
  const emitters: EmitterOptions[] = [];
  /** Footprints of hand-placed props; the dressing generator keeps clear of them. */
  const reserved: Reserved[] = [];
  const rustMat = ink({ map: tex.rust, mapping: 'world', mapScale: 0.25 });
  const ironMat = ink({ map: tex.iron, mapping: 'world', mapScale: 0.25 });
  const brassMat = ink({ map: tex.brass, mapping: 'world', mapScale: 0.5, sheen: 0.8 });
  const fireMat = ink({ color: '#000000', emissive: '#FF8A2A', emissiveIntensity: 5, emissivePreset: 'fire', hatch: false, lineWeight: 0.5 });
  const place = (o: Object3D, x: number, z: number, ry = 0) => {
    o.position.set(x, 0, z);
    o.rotation.y = ry;
    o.traverse((c) => {
      c.castShadow = true;
      c.receiveShadow = true;
    });
    scene.add(o);
    return o;
  };
  const mesh = (geo: BufferGeometry, mat: InkLitMaterial, x: number, y: number, z: number, rx = 0, rz = 0) => {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, 0, rz);
    return m;
  };

  /** Point at distance `off` from the track centre at curve parameter t (+ = left). */
  /** Distance from (x, z) to the nearest centre-line sample. */
  const distToTrack = (x: number, z: number) => {
    let d = Infinity;
    for (const smp of track.samples) d = Math.min(d, (smp.x - x) ** 2 + (smp.z - z) ** 2);
    return Math.sqrt(d);
  };
  /**
   * Point `off` metres beside the track at curve parameter t. Off-track spots must keep the same
   * clearance from every part of the track (the block layout folds back on itself): if the
   * requested side is blocked, the other side and farther offsets are tried.
   */
  const beside = (t: number, off: number, extra = 0) => {
    const at = (o: number) => {
      const p = curve.getPointAt(t);
      const left = new Vector3().crossVectors(up, curve.getTangentAt(t)).normalize();
      return { p: p.addScaledVector(left, o), yaw: Math.atan2(-left.x, -left.z) * (o > 0 ? 1 : -1) };
    };
    if (Math.abs(off) < track.halfWidth) return at(off);
    for (const o of [off, -off, off * 1.4, -off * 1.4, off * 1.9, -off * 1.9]) {
      const c = at(o);
      if (distToTrack(c.p.x, c.p.z) >= Math.abs(off) - 1 + extra) return c;
    }
    return null; // no clear spot: skip the prop rather than dropping it on the road
  };

  // Furnaces / boilers with glowing mouths, chimneys and light pools.
  const furnaceTs = [0.04, 0.2, 0.37, 0.55, 0.72, 0.88];
  furnaceTs.forEach((t, i) => {
    const side = i % 2 === 0 ? 1 : -1;
    const spot = beside(t, side * (TRACK_HALF_WIDTH + 13), 2);
    if (!spot) return;
    const { p } = spot;
    const g = new Group();
    g.add(mesh(new CylinderGeometry(4.2, 4.6, 7, 16), i % 2 ? rustMat : ironMat, 0, 3.5, 0));
    g.add(mesh(new SphereGeometry(4.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), ironMat, 0, 7, 0));
    for (const y of [1.2, 5.2]) g.add(mesh(new CylinderGeometry(4.7, 4.7, 0.4, 16), brassMat, 0, y, 0));
    g.add(mesh(new CylinderGeometry(1.1, 1.3, 14, 10), ironMat, 1.5, 14, -1.0));
    const mouth = mesh(new BoxGeometry(3.2, 2.4, 0.6), fireMat, 0, 2.2, 4.1);
    g.add(mouth);
    g.add(mesh(new BoxGeometry(3.8, 0.3, 0.8), ironMat, 0, 3.55, 4.15));
    const light = new PointLight('#FF8A2A', tunables.get('light.furnaceIntensity'), tunables.get('light.furnaceRange'), 2);
    light.position.set(0, 3, 7);
    g.add(light);
    localLights.push(light);
    place(g, p.x, p.z);
    reserved.push({ x: p.x, z: p.z, r: 7 });
    g.lookAt(curve.getPointAt(t).x, 0, curve.getPointAt(t).z);
    const pool = lightPool('#FF8A2A', 14);
    const worldLight = new Vector3();
    light.getWorldPosition(worldLight);
    pool.position.x = worldLight.x;
    pool.position.z = worldLight.z;
    scene.add(pool);
    const chimneyTop = new Vector3(1.5, 21, -1.0).applyMatrix4(g.matrixWorld.compose(g.position, g.quaternion, g.scale));
    emitters.push({ kind: 'smoke', rate: 5, position: { x: chimneyTop.x, y: chimneyTop.y, z: chimneyTop.z }, velocity: { x: 0, y: 3, z: 0 }, spread: 0.8, life: [3.5, 6], size: [3, 9] });
  });

  // Steam vents beside the track.
  for (let i = 0; i < 9; i++) {
    const t = (i + 0.5) / 9;
    const side = rng.next() > 0.5 ? 1 : -1;
    const spot = beside(t, side * (TRACK_HALF_WIDTH + 2.5));
    if (!spot) continue;
    const { p } = spot;
    const vent = new Group();
    vent.add(mesh(new CylinderGeometry(0.7, 0.9, 1.2, 10), brassMat, 0, 0.6, 0));
    vent.add(mesh(new CylinderGeometry(0.35, 0.35, 3, 8), ironMat, 1.2, 1.5, 0, 0, Math.PI / 2));
    place(vent, p.x, p.z, rng.next() * 6);
    reserved.push({ x: p.x, z: p.z, r: 2.5 });
    emitters.push({ kind: 'steam', rate: 7, position: { x: p.x, y: 1.3, z: p.z }, velocity: { x: 0, y: 3.2, z: 0 }, spread: 0.9, life: [1.8, 3.2], size: [1.2, 5.5] });
  }

  // Overhead pipe runs with supports.
  for (const [t, side] of [[0.12, 1], [0.3, -1], [0.62, 1], [0.8, -1]] as const) {
    const sa = beside(t, side * (TRACK_HALF_WIDTH + 6), 1);
    const sb = beside(t + 0.05, side * (TRACK_HALF_WIDTH + 6), 1);
    if (!sa || !sb || Math.sign(sa.p.distanceTo(curve.getPointAt(t)) - 1) !== Math.sign(sb.p.distanceTo(curve.getPointAt(t + 0.05)) - 1)) continue;
    const a = sa.p;
    const b = sb.p;
    // The pipe must not cross the road between its supports.
    if (distToTrack((a.x + b.x) / 2, (a.z + b.z) / 2) < TRACK_HALF_WIDTH + 2) continue;
    const len = a.distanceTo(b);
    const pipe = new Mesh(new CylinderGeometry(0.8, 0.8, len, 12), rustMat);
    pipe.position.copy(a).add(b).multiplyScalar(0.5).setY(4.5);
    pipe.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
    scene.add(pipe);
    for (let k = 0; k <= 4; k++) reserved.push({ x: a.x + ((b.x - a.x) * k) / 4, z: a.z + ((b.z - a.z) * k) / 4, r: 2 });
    for (const q of [a, b]) {
      const s = mesh(new BoxGeometry(0.5, 4.5, 0.5), ironMat, q.x, 2.25, q.z);
      s.castShadow = true;
      scene.add(s);
    }
    pipe.castShadow = true;
  }

  // Neon signs and billboards facing the track.
  const neonCyan = ink({ color: '#000000', emissiveMap: neonTexture('gear'), emissive: '#3FE0FF', emissiveIntensity: 4, emissivePreset: 'neon', hatch: false, phase: 1.3 });
  const neonMag = ink({ color: '#000000', emissiveMap: neonTexture('bolt'), emissive: '#FF3FB4', emissiveIntensity: 4, emissivePreset: 'neon', hatch: false, phase: 4.1 });
  const boardMat = ink({ map: textTexture(['IRON CITY', 'STEAM COUNCIL'], '#D8D2C8', '#7A2A1E'), mapping: 'uv' });
  const boardMat2 = ink({ map: textTexture(['VALVES & CO.'], '#B08A4A', '#1B1210'), mapping: 'uv' });
  [[0.09, 1, neonCyan], [0.28, -1, boardMat], [0.47, 1, neonMag], [0.66, -1, boardMat2], [0.93, 1, neonCyan]].forEach(([t, side, mat]) => {
    const spot = beside(t as number, (side as number) * (TRACK_HALF_WIDTH + 4.5), 4);
    if (!spot) return;
    const { p } = spot;
    const g = new Group();
    const isNeon = mat === neonCyan || mat === neonMag;
    g.add(mesh(new BoxGeometry(isNeon ? 5 : 9, isNeon ? 5 : 4.5, 0.4), isNeon ? ironMat : (mat as InkLitMaterial), 0, 4.5, 0));
    if (isNeon) g.add(mesh(new PlaneGeometry(4.4, 4.4), mat as InkLitMaterial, 0, 4.5, 0.22));
    for (const x of [-2.2, 2.2]) g.add(mesh(new BoxGeometry(0.3, 4.5, 0.3), ironMat, x, 1.1, -0.3));
    place(g, p.x, p.z);
    reserved.push({ x: p.x, z: p.z, r: 5 });
    const c = curve.getPointAt(t as number);
    g.lookAt(c.x, 0, c.z);
  });

  // Shell casings scattered on the track (instanced).
  const casingGeo = new CylinderGeometry(0.06, 0.06, 0.3, 6);
  casingGeo.rotateZ(Math.PI / 2);
  const casings = new InstancedMesh(casingGeo, ink({ color: '#C8A050', sheen: 1, hatch: false, lineWeight: 0 }), 500);
  const dummy = new Object3D();
  for (let i = 0; i < 500; i++) {
    const { p } = beside(rng.next(), rng.range(-TRACK_HALF_WIDTH, TRACK_HALF_WIDTH) * 0.95)!;
    dummy.position.set(p.x, 0.12, p.z);
    dummy.rotation.set(0, rng.next() * 6.28, 0);
    dummy.updateMatrix();
    casings.setMatrixAt(i, dummy.matrix);
  }
  scene.add(casings);

  // Spectator catwalk with simple figures (refs/engine 4–6).
  (() => {
    const t = 0.5;
    const spot = beside(t, -(TRACK_HALF_WIDTH + 9), 6);
    if (!spot) return;
    const { p } = spot;
    const g = new Group();
    g.add(mesh(new BoxGeometry(26, 0.6, 5), ironMat, 0, 4, 0));
    for (const x of [-12, -4, 4, 12]) g.add(mesh(new BoxGeometry(0.5, 4, 0.5), ironMat, x, 2, 0));
    g.add(mesh(new BoxGeometry(26, 1.1, 0.15), rustMat, 0, 4.85, 2.4));
    const bodyGeo = new CylinderGeometry(0.32, 0.4, 1.3, 8);
    const headGeo = new SphereGeometry(0.28, 8, 6);
    const crowdMats = ['#4A3A2E', '#5C4A3A', '#3A3330', '#6E4229', '#2E2A2E'].map((c) => ink({ color: c, lineWeight: 0.5 }));
    for (let i = 0; i < 34; i++) {
      const x = -12 + rng.next() * 24, z = rng.range(-1.8, 1.8);
      const m = crowdMats[i % crowdMats.length]!;
      g.add(mesh(bodyGeo, m, x, 4.95, z));
      g.add(mesh(headGeo, ink({ color: '#B08A70' }), x, 5.85, z));
    }
    place(g, p.x, p.z);
    reserved.push({ x: p.x, z: p.z, r: 15 });
    const c = curve.getPointAt(t);
    g.lookAt(c.x, 0, c.z);
  })();

  // Molten-metal pool with a stone rim, steam and a warm light (doc 02 §10).
  (() => {
    const spot = beside(0.64, -(TRACK_HALF_WIDTH + 17), 3);
    if (!spot) return;
    const { p } = spot;
    const pool = new Mesh(new CircleGeometry(7, 40), lavaMaterial(tex.noise));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(p.x, 0.12, p.z);
    scene.add(pool);
    const rim = new Mesh(new TorusGeometry(7.2, 0.8, 8, 40), ink({ map: tex.iron, mapping: 'world', mapScale: 0.3, color: '#9A8A80' }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(p.x, 0.3, p.z);
    rim.receiveShadow = true;
    scene.add(rim);
    const light = new PointLight('#FF6A1A', tunables.get('light.furnaceIntensity'), tunables.get('light.furnaceRange'), 2);
    light.position.set(p.x, 3, p.z);
    scene.add(light);
    localLights.push(light);
    reserved.push({ x: p.x, z: p.z, r: 10 });
    for (let k = 0; k < 3; k++)
      emitters.push({ kind: 'steam', rate: 3, position: { x: p.x + rng.range(-4, 4), y: 0.5, z: p.z + rng.range(-4, 4) }, velocity: { x: 0, y: 1.8, z: 0 }, spread: 0.8, life: [2.5, 4], size: [2, 6] });
  })();

  // Generated surroundings: props in bands around the track (doc 03 §7.3).
  const barricadeAt = (x: number, z: number, left: boolean) => {
    let best = track.samples[0]!;
    let bestD = Infinity;
    for (const smp of track.samples) {
      const d = (smp.x - x) ** 2 + (smp.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = smp;
      }
    }
    return left ? best.left : best.right;
  };
  const dressing = buildDressing(scene, curve, TRACK_HALF_WIDTH, tex, seed, reserved, barricadeAt);
  emitters.push(...dressing.emitters);
  console.info(`[world] dressing: ${dressing.instances} instances in ${dressing.instancedMeshes} instanced meshes`);

  // Foundry hall: perimeter walls and girders to close the view (fog hides the rest).
  const hallMat = ink({ map: tex.iron, mapping: 'world', mapScale: 0.08 });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const r = 190;
    const w = mesh(new BoxGeometry(70, 40, 6), hallMat, Math.cos(a) * r, 20, Math.sin(a) * r);
    w.rotation.y = -a + Math.PI / 2;
    scene.add(w);
    const pillar = mesh(new BoxGeometry(5, 46, 5), rustMat, Math.cos(a + 0.17) * (r - 6), 23, Math.sin(a + 0.17) * (r - 6));
    scene.add(pillar);
  }

  syncLights();

  const keyDir = new Vector3();
  return {
    scene,
    curve,
    trackLength,
    keyLight: key,
    emitters,
    localLights,
    update(_dt, focus) {
      // Shadow camera follows the view focus (doc 02 §3.3: single shadow map fitted to the camera).
      const pitch = (tunables.get('light.keyPitch') * Math.PI) / 180;
      const yaw = (tunables.get('light.keyYaw') * Math.PI) / 180;
      keyDir.set(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw));
      key.target.position.copy(focus);
      key.position.copy(focus).addScaledVector(keyDir, 120);
    },
  };
}


