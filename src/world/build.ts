/**
 * Generic world builder (doc 04 §3 A1): turns a compiled track + a biome definition into a scene.
 * Generic parts: lights, fog, terrain (follows the road heights, pits under jump gaps), road
 * ribbons per surface, skirts, start gantry, barricades by type, landmark slots, generated
 * dressing. Biome parts: tunables (palette, light, fog, grade), materials, themes and `decorate`.
 * Built from primitives + procedural painted textures; real modular kit art replaces it later.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Scene,
  SRGBColorSpace,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three/webgpu';
import { Rng } from '../core/rng';
import { tunables } from '../core/tunables';
import { heightFogNode, type InkLitMaterial } from '../render/ink/ink-material';
import type { ProceduralSet } from '../render/procedural/textures';
import type { EmitterOptions } from '../render/fx/particles';
import { buildDressing, type Reserved } from '../game/dressing';
import { sampleAt, type CompiledTrack } from '../track/compile';
import { JUMP, type Surface } from '../track/track-format';
import { SEVERITY_COLOR, classifyCorners } from '../track/corners';
import type { BiomeDef, SurfaceLook, WorldContext } from './biome';
import { RainField, checkerTexture, ink, lavaMaterial, ribbonFromSamples, skirtFromSamples, textTexture, viewHeightLimit } from './kit';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

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

export interface GameWorld {
  biome: BiomeDef;
  scene: Scene;
  curve: CatmullRomCurve3;
  trackLength: number;
  keyLight: DirectionalLight;
  emitters: EmitterOptions[];
  /** Point lights that the quality manager may cap. */
  localLights: PointLight[];
  /** Ground height under a point. */
  heightAt(x: number, z: number): number;
  update(dt: number, focus: Vector3): void;
  /** Drop the tunables listeners (the scene itself is disposed by the owner). */
  dispose(): void;
}

/** Road looks used when a biome does not override a surface. */
const DEFAULT_SURFACES: Record<Surface, SurfaceLook> = {
  plate: { tex: 'plates' },
  grate: { tex: 'grate', scale: 2 },
  dirt: { tex: 'dirt', scale: 2, tint: '#E0CCB8' },
  sand: { tex: 'dirt', scale: 2, tint: '#F4E0B8' },
  oil: { tex: 'plates', tint: '#5A4E48', sheen: 0.6 },
  water: { tex: 'dirt', scale: 2, tint: '#6A7A80', sheen: 0.9 },
  flagstone: { tex: 'flagstone', scale: 1, tint: '#A8A6A4' },
  rails: { tex: 'rails', scale: 1 },
  cobble: { tex: 'cobble', scale: 1.5, tint: '#B4A898', sheen: 0.3 },
  scrap: { tex: 'rust', scale: 1.5, tint: '#C8B4A0' },
  mud: { tex: 'dirt', scale: 2, tint: '#8A7060', sheen: 0.5 },
  heartwood: { tex: 'planks', scale: 1, tint: '#A89C8C' },
  moss: { tex: 'dirt', scale: 2, tint: '#7A9A6A' },
};

const surfaceMaterial = (tex: ProceduralSet, look: SurfaceLook): InkLitMaterial =>
  ink({ map: tex[look.tex], mapping: 'uv', mapScale: look.scale ?? 1, lineWeight: 0.5, color: look.tint, sheen: look.sheen });

/**
 * Ground heights on a grid (elevated tracks only): near the road the ground is the lowest road
 * within reach (so a lower road is never covered by the slope of a higher one; skirts close the
 * higher edge), jump gaps sink into a pit, elsewhere it follows the nearest road.
 */
function makeHeightField(track: CompiledTrack): { heightAt(x: number, z: number): number; grid: { x0: number; z0: number; step: number; nx: number; nz: number; h: Float32Array } } {
  const step = 4;
  const margin = 260;
  const x0 = track.bounds.minX - margin;
  const z0 = track.bounds.minZ - margin;
  const nx = Math.ceil((track.bounds.maxX - track.bounds.minX + margin * 2) / step) + 1;
  const nz = Math.ceil((track.bounds.maxZ - track.bounds.minZ + margin * 2) / step) + 1;
  const h = new Float32Array(nx * nz);
  const sub = track.samples.filter((_, i) => i % 2 === 0);
  const reach = (track.halfWidth + 7) ** 2;
  const pitY = (i: number) => {
    const p = sub[i]!;
    return p.feature === 'gap' ? p.y - JUMP.lip - JUMP.pit : p.y - 0.25;
  };
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * step;
      const z = z0 + j * step;
      let best = 0;
      let bestD = Infinity;
      let low = Infinity;
      for (let k = 0; k < sub.length; k++) {
        const p = sub[k]!;
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
        if (d < reach) low = Math.min(low, pitY(k));
      }
      h[j * nx + i] = low < Infinity ? low : pitY(best);
    }
  const heightAt = (x: number, z: number) => {
    const fx = Math.min(nx - 1.001, Math.max(0, (x - x0) / step));
    const fz = Math.min(nz - 1.001, Math.max(0, (z - z0) / step));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = h[j * nx + i]!;
    const b = h[j * nx + i + 1]!;
    const c = h[(j + 1) * nx + i]!;
    const d = h[(j + 1) * nx + i + 1]!;
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  };
  return { heightAt, grid: { x0, z0, step, nx, nz, h } };
}

/**
 * Tunables a biome may set (palette, light, fog, grade, wind). They go back to their defaults
 * before every world is built, so a race in one world never inherits the look of the previous one.
 */
const WORLD_KEYS = /^(light\.|fog\.|ink\.(color|litTint|shadowColor|wrap|bands|bandSoftness|hatchStrength)$|post\.(exposure|contrast|saturation|lift|gain|vignette|grain|paper|bloomStrength|bloomThreshold|bloomRadius)$|fx\.wind$)/;

export function buildWorld(biome: BiomeDef, tex: ProceduralSet, seed: number, track: CompiledTrack, opts: { rain?: boolean } = {}): GameWorld {
  // Palette, light, fog and grade of the biome (doc 02 §12 per world) go through the tunables,
  // so the debug panel shows and edits the values actually in use.
  for (const t of tunables.all()) if (WORLD_KEYS.test(t.def.key)) tunables.reset(t.def.key);
  tunables.applyPreset(biome.tunables);
  const rng = new Rng(seed);
  const scene = new Scene();
  scene.background = new Color(tunables.get<string>('fog.color'));
  (scene as N).fogNode = heightFogNode();
  const offs: (() => void)[] = [];
  offs.push(
    tunables.onChange((k, v) => {
      if (k === 'fog.color') (scene.background as Color).set(v as string);
    }),
  );

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
  offs.push(tunables.onChange((k) => k.startsWith('light.') && syncLights()));

  // --- Ground ---------------------------------------------------------------------
  const elevated = track.bounds.minY !== 0 || track.bounds.maxY !== 0 || track.samples.some((s) => s.feature !== 'road');
  const groundMat = ink({ map: tex[biome.ground.tex], mapping: 'world', mapScale: biome.ground.scale ?? 1 / 10, lineWeight: 0.5, color: biome.ground.tint });
  let heightAt = (_x: number, _z: number) => 0;
  if (!elevated) {
    const ground = new Mesh(new PlaneGeometry(700, 700), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
  } else {
    const hf = makeHeightField(track);
    heightAt = hf.heightAt;
    const { x0, z0, step, nx, nz, h } = hf.grid;
    const geo = new PlaneGeometry((nx - 1) * step, (nz - 1) * step, nx - 1, nz - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.getAttribute('position');
    // PlaneGeometry rows run from -z to +z after the rotation; map each vertex to its grid cell.
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k) + x0 + ((nx - 1) * step) / 2;
      const z = pos.getZ(k) + z0 + ((nz - 1) * step) / 2;
      const i = Math.round((x - x0) / step);
      const j = Math.round((z - z0) / step);
      pos.setXYZ(k, x, h[j * nx + i]!, z);
    }
    geo.computeVertexNormals();
    const ground = new Mesh(geo, groundMat);
    ground.receiveShadow = true;
    scene.add(ground);
  }

  // Decoration helper curve through the compiled centre line (props are placed with it).
  const pts: Vector3[] = [];
  for (let i = 0; i < track.samples.length; i += 4) pts.push(new Vector3(track.samples[i]!.x, 0, track.samples[i]!.z));
  const curve = new CatmullRomCurve3(pts, true, 'centripetal');
  const trackLength = track.length;
  const up = new Vector3(0, 1, 0);
  const n = track.samples.length;

  // --- Road surfaces: one ribbon per run of equal surface, none over jump gaps. ------------
  const surfaceMats = new Map<Surface, InkLitMaterial>();
  const matOf = (s: Surface) => {
    let m = surfaceMats.get(s);
    if (!m) {
      m = surfaceMaterial(tex, biome.surfaces?.[s] ?? DEFAULT_SURFACES[s]);
      surfaceMats.set(s, m);
    }
    return m;
  };
  const runKey = (i: number) => (track.samples[i]!.feature === 'gap' ? '#gap' : track.samples[i]!.surface);
  let runStart = 0;
  while (runStart < n && runKey(runStart) === runKey((runStart - 1 + n) % n)) runStart++;
  if (runStart >= n) runStart = 0;
  const sk = biome.skirt;
  const skirtMat = ink({ map: tex[sk?.tex ?? 'iron'], mapping: 'world', mapScale: sk?.scale ?? 0.2, color: sk?.tint ?? '#9A8E84', sheen: sk?.sheen });
  skirtMat.side = DoubleSide;
  for (let k = 0; k < n; ) {
    const i0 = (runStart + k) % n;
    const key0 = runKey(i0);
    let len = 1;
    while (k + len < n && runKey((runStart + k + len) % n) === key0) len++;
    if (key0 !== '#gap') {
      // One more sample closes the joint, except into a gap (the road ends at the lip).
      const into = runKey((i0 + len) % n) === '#gap' ? 0 : 1;
      const road = new Mesh(ribbonFromSamples(track, i0, len + into, track.halfWidth, 0.05), matOf(key0 as Surface));
      road.receiveShadow = true;
      scene.add(road);
      if (elevated)
        for (const side of [-1, 1]) {
          const sk = new Mesh(skirtFromSamples(track, i0, len + into, track.halfWidth + 0.02, side, 14), skirtMat);
          sk.receiveShadow = true;
          scene.add(sk);
        }
    }
    k += len;
  }

  // Jump pits: a floor under every gap (lava or dark scrap), lit by the biome.
  track.jumps.forEach((j) => {
    const i0 = Math.round(j.gap0 / track.spacing) % n;
    const i1 = Math.round(j.gap1 / track.spacing) % n;
    const count = ((i1 - i0 + n) % n) + 1;
    const base = Math.min(sampleAt(track, j.s0).y, sampleAt(track, j.s1).y) - JUMP.pit + 0.3;
    const floor = new Mesh(
      ribbonFromSamples(track, i0, count, track.halfWidth + 7, 0, () => base),
      biome.pit === 'lava' ? lavaMaterial(tex.noise) : ink({ map: tex.rust, mapping: 'world', mapScale: 0.3, color: '#5A4E48' }),
    );
    scene.add(floor);
  });

  // Start/finish line: checker strip + gantry at lineS.
  {
    const smp = sampleAt(track, track.lineS);
    const yaw = Math.atan2(smp.tx, smp.tz);
    const line = new Mesh(new PlaneGeometry(track.halfWidth * 2, 2.2), ink({ map: checkerTexture(), mapping: 'uv', hatch: false, lineWeight: 0.5 }));
    line.rotation.set(-Math.PI / 2, 0, yaw);
    line.position.set(smp.x, smp.y + 0.09, smp.z);
    scene.add(line);
    const gantry = new Group();
    const ironG = ink({ map: tex.iron, mapping: 'world', mapScale: 0.3 });
    for (const side of [-1, 1]) {
      const post = new Mesh(new BoxGeometry(0.8, 8, 0.8), ironG);
      post.position.set(side * (track.halfWidth + 1.5), 4, 0);
      gantry.add(post);
    }
    const beam = new Mesh(new BoxGeometry(track.halfWidth * 2 + 4, 1.4, 1), ink({ map: textTexture(biome.gantry.lines, biome.gantry.bg, biome.gantry.fg, 1024, 128), mapping: 'uv' }));
    beam.position.set(0, 8, 0);
    gantry.add(beam);
    gantry.position.set(smp.x, smp.y, smp.z);
    gantry.rotation.y = yaw;
    gantry.traverse((o) => {
      if (!(o as Mesh).isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
    });
    scene.add(gantry);
  }

  buildBarricades(scene, tex, track);
  buildCornerBoards(scene, track);

  // --- Context for the biome hooks ---------------------------------------------------
  const emitters: EmitterOptions[] = [];
  /** Footprints of hand-placed props; the dressing generator keeps clear of them. */
  const reserved: Reserved[] = [];
  const distToTrack = (x: number, z: number) => {
    let d = Infinity;
    for (const smp of track.samples) d = Math.min(d, (smp.x - x) ** 2 + (smp.z - z) ** 2);
    return Math.sqrt(d);
  };
  const place = (o: Object3D, x: number, z: number, ry = 0) => {
    o.position.set(x, heightAt(x, z), z);
    o.rotation.y = ry;
    // Meshes only: a light in the group must not cast shadows (a point light shadow is a cube map,
    // six extra renders of the scene per frame).
    o.traverse((c) => {
      if (!(c as Mesh).isMesh) return;
      c.castShadow = true;
      c.receiveShadow = true;
    });
    scene.add(o);
    return o;
  };
  const beside = (t: number, off: number, extra = 0) => {
    const at = (o: number) => {
      const p = curve.getPointAt(t);
      const left = new Vector3().crossVectors(up, curve.getTangentAt(t)).normalize();
      p.addScaledVector(left, o);
      p.y = heightAt(p.x, p.z);
      return { p, yaw: Math.atan2(-left.x, -left.z) * (o > 0 ? 1 : -1) };
    };
    if (Math.abs(off) < track.halfWidth) return at(off);
    for (const o of [off, -off, off * 1.4, -off * 1.4, off * 1.9, -off * 1.9]) {
      const c = at(o);
      if (distToTrack(c.p.x, c.p.z) >= Math.abs(off) - 1 + extra) return c;
    }
    return null; // no clear spot: skip the prop rather than dropping it on the road
  };
  const animations: ((dt: number, time: number) => void)[] = [];
  const ctx: WorldContext = { scene, track, curve, tex, rng, seed, reserved, emitters, localLights, heightAt, distToTrack, beside, place, ink, animate: (fn) => animations.push(fn) };

  // Landmark slots: reserved, built by the biome or a generic plinth (doc 04 A2).
  for (const lm of track.landmarks) {
    reserved.push({ x: lm.x, z: lm.z, r: lm.r });
    if (biome.landmark?.(ctx, lm)) continue;
    const g = new Group();
    const stoneM = ink({ map: tex.iron, mapping: 'world', mapScale: 0.15, color: '#B0A8A0' });
    const plinth = new Mesh(new CylinderGeometry(lm.r * 0.6, lm.r * 0.7, 2, 8), stoneM);
    plinth.position.y = 1;
    g.add(plinth);
    const obelisk = new Mesh(new BoxGeometry(lm.r * 0.25, lm.r * 1.4, lm.r * 0.25), stoneM);
    obelisk.position.y = 2 + lm.r * 0.7;
    g.add(obelisk);
    place(g, lm.x, lm.z, lm.facing);
  }

  biome.decorate?.(ctx);

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
  const dressing = buildDressing(scene, curve, track.halfWidth, tex, seed, reserved, barricadeAt, { heightAt, themes: biome.themes, theme: biome.theme, props: biome.props?.bind(biome), debris: biome.debris,
    heightLimit: biome.clearView ? (x, z, inset) => viewHeightLimit(track, x, z, inset, tunables.get<number>('camera.board.azimuth'), tunables.get<number>('camera.board.pitch')) : undefined });
  emitters.push(...dressing.emitters);
  console.info(`[world] ${biome.id}: dressing ${dressing.instances} instances in ${dressing.instancedMeshes} instanced meshes`);

  syncLights();

  const rain = biome.rain && opts.rain !== false ? new RainField(scene, biome.rain) : null;
  let clock = 0;
  const keyDir = new Vector3();
  return {
    biome,
    scene,
    curve,
    trackLength,
    keyLight: key,
    emitters,
    localLights,
    heightAt,
    dispose() {
      for (const off of offs) off();
    },
    update(dt, focus) {
      clock += dt;
      for (const a of animations) a(dt, clock);
      rain?.update(focus);
      // Shadow camera follows the view focus (doc 02 §3.3: single shadow map fitted to the camera).
      const pitch = (tunables.get('light.keyPitch') * Math.PI) / 180;
      const yaw = (tunables.get('light.keyYaw') * Math.PI) / 180;
      keyDir.set(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw));
      key.target.position.copy(focus);
      key.position.copy(focus).addScaledVector(keyDir, 120);
    },
  };
}

/** Barricades by type (gameplay.md §6.3, doc 04 §5), instanced, following the road heights. */
function buildBarricades(scene: Scene, tex: ProceduralSet, track: CompiledTrack): void {
  const n = track.samples.length;
  const up = new Vector3(0, 1, 0);
  const right = new Vector3(1, 0, 0);
  const wallGeo = new BoxGeometry(0.5, 1.3, 4.1);
  const tallGeo = new BoxGeometry(0.7, 1.6, 4.1);
  const wallMat = ink({ map: tex.rust, mapping: 'world', mapScale: 0.35 });
  const corrugatedMat = ink({ map: tex.iron, mapping: 'world', mapScale: 0.6, color: '#C8BEB4' });
  const stoneMat = ink({ map: tex.flagstone, mapping: 'world', mapScale: 0.25, color: '#9A9894' });
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
  const rootMat = ink({ map: tex.planks, mapping: 'world', mapScale: 0.3, color: '#6A5A48' });
  const postGeo = new BoxGeometry(0.18, 1.6, 0.18);
  const wireGeo = new BoxGeometry(0.04, 0.04, 4.2);
  const postMat = ink({ color: '#5C4A3A' });
  const wireMat = ink({ color: '#8C8078', lineWeight: 0.3 });
  const pylonGeo = new BoxGeometry(0.6, 2.2, 0.6);
  const arcGeo = new BoxGeometry(0.08, 0.08, 4.1);
  const arcMat = ink({ color: '#000000', emissive: '#3FC8FF', emissiveIntensity: 4, emissivePreset: 'neon', hatch: false, lineWeight: 0 });
  const railGeo = new BoxGeometry(0.1, 0.1, 4.2);
  const ironMat = ink({ color: '#3A3634', sheen: 0.5 });
  const crystalGeo = new BoxGeometry(0.35, 1.2, 4.0);
  const crystalMat = ink({ color: '#5AA8A0', emissive: '#3FF0E0', emissiveIntensity: 1.2, emissivePreset: 'neon', sheen: 1 });
  const L: Record<string, Matrix4[]> = {
    wall: [], corr: [], stone: [], spike: [], tyre: [], beam: [], bag: [], berm: [], root: [], post: [], wire: [], pylon: [], arc: [], rail: [], railPost: [], crystal: [],
  };
  const step = 4.2;
  const steps = Math.floor(track.length / step);
  const one = new Vector3(1, 1, 1);
  for (let i = 0; i < steps; i++) {
    const d = i * step + step / 2;
    const sp = sampleAt(track, d);
    if (sp.feature === 'gap') continue;
    const smp = track.samples[Math.round(d / track.spacing) % n]!;
    const yaw = Math.atan2(sp.tx, sp.tz);
    // Follow the slope: yaw, then pitch about the local right axis.
    const q = new Quaternion().setFromAxisAngle(up, yaw).multiply(new Quaternion().setFromAxisAngle(right, -Math.atan(sp.grade)));
    const tight = Math.abs(sp.curvature) > 0.06;
    for (const side of [-1, 1]) {
      const type = side > 0 ? smp.right : smp.left;
      // Driver's right of the tangent: (-tz, tx).
      const ox = -sp.tz * side;
      const oz = sp.tx * side;
      const off = track.halfWidth + 0.7;
      const at = (dd: number, y: number) => new Vector3(sp.x + ox * dd, sp.y + y, sp.z + oz * dd);
      const M = (pos: Vector3, rot: Quaternion = q) => new Matrix4().compose(pos, rot, one);
      if (tight && (type === 'riveted' || type === 'corrugated')) {
        // Tyre walls in tight corners (refs/engine 3), behind the contact line of the invisible rail.
        for (let k = 0; k < 3; k++) L.tyre!.push(new Matrix4().makeTranslation(sp.x + ox * (off + 0.5), sp.y + 0.25 + k * 0.5, sp.z + oz * (off + 0.5)));
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
        case 'wreckwall':
          L.wall!.push(M(at(off + 0.3, 0.65)));
          if (i % 2 === 0)
            for (const [rx, ry] of [[0.6, 0.6], [-0.6, 0.6], [0, -0.75]] as const) {
              L.beam!.push(M(at(off - 0.6, 0.9), new Quaternion().setFromEuler(new Euler(rx, yaw + ry, 0))));
            }
          if (type === 'wreckwall' && i % 2 === 1) for (let k = 0; k < 2; k++) L.tyre!.push(M(at(off + 0.2, 1.5 + k * 0.5)));
          break;
        case 'sandbags': {
          const rot = new Quaternion().setFromAxisAngle(up, yaw + Math.PI / 2);
          for (let row = 0; row < 3; row++)
            for (let b = 0; b < 4; b++) {
              const along = -1.6 + b * 1.05 + row * 0.5;
              L.bag!.push(M(new Vector3(sp.x + ox * (off - 0.2) + sp.tx * along, sp.y + 0.22 + row * 0.42 + sp.grade * along, sp.z + oz * (off - 0.2) + sp.tz * along), rot));
            }
          break;
        }
        case 'earth':
          L.berm!.push(M(at(off + 0.3, 0)));
          break;
        case 'roots':
          L.root!.push(M(at(off + 0.3, -0.1)));
          if (i % 2 === 0) L.berm!.push(M(at(off + 1.2, -0.3)));
          break;
        case 'barbed':
          L.post!.push(M(at(off, 0.8)));
          for (const y of [0.6, 1.1, 1.5]) L.wire!.push(M(at(off, y)));
          break;
        case 'stone':
          L.stone!.push(M(at(off, 0.8)));
          break;
        case 'runepylon':
          if (i % 2 === 0) L.pylon!.push(M(at(off, 1.1)));
          L.arc!.push(M(at(off, 0.7)));
          L.arc!.push(M(at(off, 1.5)));
          break;
        case 'ironrail':
          L.railPost!.push(M(at(off, 0.6)));
          for (const y of [0.55, 1.05]) L.rail!.push(M(at(off, y)));
          break;
        case 'tyres':
          for (let k = 0; k < 3; k++) L.tyre!.push(M(at(off + 0.4, 0.25 + k * 0.5)));
          break;
        case 'crystal':
          L.crystal!.push(M(at(off, 0.6)));
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
  inst(tallGeo, stoneMat, L.stone!);
  inst(spikeGeo, spikeMat, L.spike!);
  inst(tyreGeo, tyreMat, L.tyre!);
  inst(beamGeo, spikeMat, L.beam!);
  inst(bagGeo, bagMat, L.bag!);
  inst(bermGeo, bermMat, L.berm!);
  inst(bermGeo, rootMat, L.root!);
  inst(postGeo, postMat, L.post!);
  inst(wireGeo, wireMat, L.wire!);
  inst(pylonGeo, stoneMat, L.pylon!);
  inst(arcGeo, arcMat, L.arc!);
  inst(railGeo, ironMat, L.rail!);
  inst(postGeo, ironMat, L.railPost!);
  inst(crystalGeo, crystalMat, L.crystal!);
}

tunables.registerGroup('world', [
  { key: 'world.cornerBoards', type: 'boolean', default: true, label: 'Chevron boards on tight corners (rebuild)' },
]);

/** Painted chevron board: `count` chevrons in `color`, pointing right (left when `flip`). */
function chevronTexture(count: number, color: string, flip: boolean): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#231915';
  ctx.fillRect(0, 0, 256, 160);
  ctx.strokeStyle = '#1B1210';
  ctx.lineWidth = 12;
  ctx.strokeRect(0, 0, 256, 160);
  ctx.strokeStyle = color;
  ctx.lineWidth = 26;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  if (flip) {
    ctx.translate(256, 0);
    ctx.scale(-1, 1);
  }
  const w = 52;
  const x0 = 128 - ((count - 1) * w) / 2 - 18;
  for (let k = 0; k < count; k++) {
    const x = x0 + k * w;
    ctx.beginPath();
    ctx.moveTo(x, 30);
    ctx.lineTo(x + 40, 80);
    ctx.lineTo(x, 130);
    ctx.stroke();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // Grime.
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = `rgba(122,74,46,${(0.05 + (i % 5) * 0.03).toFixed(2)})`;
    ctx.fillRect((i * 97) % 256, (i * 53) % 160, 6 + (i % 4) * 5, 3 + (i % 3) * 4);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * Chevron boards on the outside of tight bends and hairpins (track/corners.ts), the in-world twin of
 * the corner tag: two chevrons (orange) on tight bends, three (red) on hairpins, pointing into the
 * turn, facing the approaching driver, behind the barricade.
 */
function buildCornerBoards(scene: Scene, track: CompiledTrack): void {
  if (!tunables.get<boolean>('world.cornerBoards')) return;
  const up = new Vector3(0, 1, 0);
  const one = new Vector3(1, 1, 1);
  const boards = new Map<string, Matrix4[]>();
  const posts: Matrix4[] = [];
  const spacing = 6;
  for (const corner of classifyCorners(track)) {
    for (const bend of corner.bends) {
      if (bend.kind === 'wide') continue;
      const key = `${bend.kind}${bend.turn}`;
      const list = boards.get(key) ?? [];
      boards.set(key, list);
      // Outside of the turn: driver's left on a right turn.
      const side = bend.turn === 'R' ? -1 : 1;
      const len = bend.s1 - bend.s0;
      const n = Math.max(2, Math.round(len / spacing));
      for (let k = 0; k <= n; k++) {
        const d = bend.s0 + (k / n) * len;
        const sp = sampleAt(track, d);
        if (sp.feature === 'gap') continue;
        // Face a driver a few metres back: the board turns towards the road.
        const back = sampleAt(track, d - 8);
        const yaw = Math.atan2(back.tx, back.tz) + Math.PI;
        const off = track.halfWidth + 1.9;
        const x = sp.x - sp.tz * side * off;
        const z = sp.z + sp.tx * side * off;
        const q = new Quaternion().setFromAxisAngle(up, yaw);
        list.push(new Matrix4().compose(new Vector3(x, sp.y + 1.75, z), q, one));
        posts.push(new Matrix4().compose(new Vector3(x, sp.y + 0.7, z), q, one));
      }
    }
  }
  if (!posts.length) return;
  const boardGeo = new BoxGeometry(1.5, 0.95, 0.08);
  const postGeo = new BoxGeometry(0.14, 1.4, 0.14);
  const add = (geo: BufferGeometry, mat: InkLitMaterial | InkLitMaterial[], list: Matrix4[]) => {
    const m = new InstancedMesh(geo, mat, list.length);
    list.forEach((mx, i) => m.setMatrixAt(i, mx));
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  };
  const plain = ink({ color: '#3A3028' });
  add(postGeo, plain, posts);
  for (const [key, list] of boards) {
    if (!list.length) continue;
    const hairpin = key.startsWith('hairpin');
    const count = hairpin ? 3 : 2;
    const color = SEVERITY_COLOR[count];
    const left = key.endsWith('L');
    // Box groups: +x, −x, +y, −y, +z (towards the driver), −z. The back is painted mirrored so the
    // chevrons point the same way on the ground from both sides (the board camera sees either).
    const front = ink({ map: chevronTexture(count, color, left), color: '#ffffff' });
    const back = ink({ map: chevronTexture(count, color, !left), color: '#ffffff' });
    add(boardGeo, [plain, plain, plain, plain, front, back], list);
  }
}
