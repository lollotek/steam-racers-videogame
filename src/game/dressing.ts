/**
 * Seeded set-dressing generator (doc 03 §7.3 "generated surroundings", first version).
 * Fills bands around the track with props from a small kit, then batches every
 * (geometry, material) pair into one InstancedMesh so the draw-call count stays low.
 *
 *   edge  band: right behind the barriers — barrels, crates, tyres, sandbags, braziers, scrap
 *   mid   band: machinery — boilers, generators, pipe clusters, scrap piles, big gears
 *   far   band: silhouettes — storage tanks, chimneys (smoke), girder towers
 */
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type CatmullRomCurve3,
  type Material,
  type Scene,
} from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { float, smoothstep, uv, vec4 } from 'three/tsl';
import { Rng } from '../core/rng';
import { tunables } from '../core/tunables';
import { InkLitMaterial } from '../render/ink/ink-material';
import type { ProceduralSet } from '../render/procedural/textures';
import type { EmitterOptions } from '../render/fx/particles';
import type { Barricade } from '../track/track-format';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

tunables.registerGroup('dressing', [
  { key: 'dressing.edgeDensity', type: 'number', default: 1, min: 0, max: 3, step: 0.05, label: 'Edge band density (reload)' },
  { key: 'dressing.midDensity', type: 'number', default: 1, min: 0, max: 3, step: 0.05, label: 'Mid band density (reload)' },
  { key: 'dressing.farDensity', type: 'number', default: 1, min: 0, max: 3, step: 0.05, label: 'Far band density (reload)' },
  { key: 'dressing.debris', type: 'number', default: 1800, min: 0, max: 8000, step: 100, label: 'Ground debris count (reload)' },
]);

export interface Reserved {
  x: number;
  z: number;
  r: number;
}

interface Part {
  geo: BufferGeometry;
  mat: Material;
  m: Matrix4;
  shadow?: boolean;
}

type Band = 'edge' | 'mid' | 'far';

interface PropDef {
  name: string;
  radius: number;
  bands: Band[];
  weight: number;
  build(rng: Rng): Part[];
  /** Optional smoke/steam emitter at a local point. */
  emitter?: (rng: Rng) => { local: Vector3; opts: Omit<EmitterOptions, 'position'> };
  /** Additive glow pool (color, radius). */
  pool?: [string, number];
}

/**
 * What lies beyond each barricade type: the edge of a piece decides its whole surroundings
 * (gameplay.md §6.3, doc 03 §7.3). `mul` multiplies prop weights (`other` for the rest),
 * `density` thins every band.
 */
export interface Theme {
  density: number;
  other: number;
  mul: Record<string, number>;
}

const THEMES: Partial<Record<Barricade, Theme>> = {
  // Riveted plates: the foundry itself — boilers, pipes, gears.
  riveted: { density: 1, other: 1, mul: { hedgehogs: 0, shack: 0, bunker: 0, rocks: 0, wireCoil: 0, wreck: 0.3 } },
  // Corrugated sheet: depots and shanty workshops.
  corrugated: { density: 1, other: 1, mul: { shack: 5, crates: 2.5, barrel: 1.5, tank: 1.5, boiler: 0.4, generator: 0.5, pipes: 0.5, bigGear: 0.3, chimney: 0.5, hedgehogs: 0, bunker: 0, rocks: 0, wireCoil: 0, wreck: 0.5 } },
  // Czech hedgehogs: scrapyard and tank traps.
  hedgehog: { density: 1, other: 0.5, mul: { hedgehogs: 6, scrapPile: 3, scrapSmall: 3, wreck: 3.5, spikeFence: 2.5, tyres: 2, tower: 1, wireCoil: 1, rocks: 0.5, boiler: 0.2, generator: 0.2, pipes: 0.3, tank: 0.4, chimney: 0.4, shack: 0, bunker: 0 } },
  // Sandbags: a fortified post.
  sandbags: { density: 1, other: 0.4, mul: { sandbags: 5, bunker: 5, crates: 2.5, brazier: 2.5, barrel: 1, tower: 1.5, wireCoil: 1, hedgehogs: 1, boiler: 0, pipes: 0, bigGear: 0, generator: 0.3, tank: 0.3, chimney: 0.2, shack: 0.5, rocks: 0.3, wreck: 0.3 } },
  // Bare earth: open wasteland, rocks and little else.
  earth: { density: 0.5, other: 0.1, mul: { rocks: 8, scrapSmall: 1, barrelTipped: 1, wreck: 0.8, tyres: 0.5 } },
  // Barbed wire: no man's land.
  barbed: { density: 0.75, other: 0.12, mul: { wireCoil: 7, hedgehogs: 2.5, spikeFence: 3, rocks: 2, wreck: 1, scrapSmall: 1, sandbags: 1 } },
};

/** v2 barricades without a theme of their own borrow the closest v1 surroundings (biomes may override). */
const THEME_FALLBACK: Record<Barricade, Barricade> = {
  earth: 'earth', riveted: 'riveted', hedgehog: 'hedgehog', corrugated: 'corrugated', sandbags: 'sandbags', barbed: 'barbed',
  stone: 'riveted', runepylon: 'riveted', ironrail: 'corrugated', wreckwall: 'hedgehog', tyres: 'hedgehog', roots: 'earth', crystal: 'earth',
};

export interface DressingOptions {
  /** Ground height under a point (elevated tracks, doc 04 A5). Default: flat at 0. */
  heightAt?: (x: number, z: number) => number;
  /** Biome themes per barricade (override the defaults). */
  themes?: Partial<Record<Barricade, Theme>>;
}

export interface DressingResult {
  emitters: EmitterOptions[];
  instancedMeshes: number;
  instances: number;
}

const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(sx, sy, sz));

function gearGeometry(radius: number, teeth: number, thickness: number): BufferGeometry {
  const parts: BufferGeometry[] = [new CylinderGeometry(radius, radius, thickness, 24)];
  const tooth = new BoxGeometry(radius * 0.28, thickness, radius * 0.3);
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const g = tooth.clone();
    g.rotateY(-a);
    g.translate(Math.cos(a) * radius * 1.08, 0, Math.sin(a) * radius * 1.08);
    parts.push(g);
  }
  const hub = new CylinderGeometry(radius * 0.25, radius * 0.25, thickness * 1.6, 12);
  parts.push(hub);
  return mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
}

function makeKit(tex: ProceduralSet) {
  const ink = (p: ConstructorParameters<typeof InkLitMaterial>[0]) => new InkLitMaterial(p);
  const mats = {
    rust: ink({ map: tex.rust, mapping: 'world', mapScale: 0.3 }),
    iron: ink({ map: tex.iron, mapping: 'world', mapScale: 0.3 }),
    ironLight: ink({ map: tex.iron, mapping: 'world', mapScale: 0.3, color: new Color(1.6, 1.5, 1.45) }),
    brass: ink({ map: tex.brass, mapping: 'world', mapScale: 0.6, sheen: 0.8 }),
    wood: ink({ map: tex.rust, mapping: 'world', mapScale: 0.4, color: '#B89A70' }),
    grate: ink({ map: tex.grate, mapping: 'world', mapScale: 0.5 }),
    rubber: ink({ color: '#2E2826' }),
    sand: ink({ map: tex.dirt, mapping: 'world', mapScale: 0.5, color: '#D8C8A8' }),
    dark: ink({ color: '#3A3330' }),
    debris: ink({ color: '#6E655E', lineWeight: 0 }),
    fire: ink({ color: '#000000', emissive: '#FF8A2A', emissiveIntensity: 6, emissivePreset: 'fire', hatch: false, lineWeight: 0.3 }),
    neonCyan: ink({ color: '#000000', emissive: '#3FE0FF', emissiveIntensity: 3.5, emissivePreset: 'neon', hatch: false, phase: 2.2 }),
    neonMagenta: ink({ color: '#000000', emissive: '#FF3FB4', emissiveIntensity: 3.5, emissivePreset: 'neon', hatch: false, phase: 5.7 }),
  };
  const g = {
    barrel: new CylinderGeometry(0.6, 0.6, 1.4, 12),
    hoop: new CylinderGeometry(0.64, 0.64, 0.12, 12),
    box: new BoxGeometry(1, 1, 1),
    cyl: new CylinderGeometry(1, 1, 1, 14),
    cylLow: new CylinderGeometry(1, 1, 1, 8),
    sphere: new SphereGeometry(1, 12, 8),
    tyre: (() => {
      const t = new TorusGeometry(0.55, 0.25, 8, 14);
      t.rotateX(Math.PI / 2);
      return t;
    })(),
    cone: new CylinderGeometry(0, 1, 1, 6),
    gear: gearGeometry(1, 12, 0.35),
    bag: (() => {
      const s = new SphereGeometry(0.5, 10, 6);
      s.scale(1.1, 0.45, 0.65);
      return s;
    })(),
    flame: new CylinderGeometry(0, 0.5, 1.1, 7),
    plate: new BoxGeometry(1, 0.06, 1),
  };
  return { mats, g };
}

export function buildDressing(
  scene: Scene,
  curve: CatmullRomCurve3,
  halfWidth: number,
  tex: ProceduralSet,
  seed: number,
  reserved: Reserved[],
  /** Barricade type of the track edge nearest to a centre-line point, on its left or right side. */
  barricadeAt: (x: number, z: number, left: boolean) => Barricade = () => 'riveted',
  opts: DressingOptions = {},
): DressingResult {
  const heightAt = opts.heightAt ?? (() => 0);
  const themeOf = (b: Barricade): Theme => opts.themes?.[b] ?? THEMES[b] ?? opts.themes?.[THEME_FALLBACK[b]] ?? THEMES[THEME_FALLBACK[b]]!;
  const rng = new Rng(seed * 7919 + 13);
  const { mats, g } = makeKit(tex);

  const props: PropDef[] = [
    // ---- edge band -----------------------------------------------------------
    { name: 'barrel', radius: 0.8, bands: ['edge', 'mid'], weight: 5, build: (r) => [
      { geo: g.barrel, mat: r.next() > 0.5 ? mats.rust : mats.iron, m: M(0, 0.7, 0) },
      { geo: g.hoop, mat: mats.brass, m: M(0, 0.35, 0) },
      { geo: g.hoop, mat: mats.brass, m: M(0, 1.05, 0) },
    ] },
    { name: 'barrelTipped', radius: 1.0, bands: ['edge'], weight: 2, build: () => [{ geo: g.barrel, mat: mats.rust, m: M(0, 0.6, 0, 0, 0, Math.PI / 2) }] },
    { name: 'crates', radius: 1.6, bands: ['edge', 'mid'], weight: 4, build: (r) => {
      const parts: Part[] = [];
      const n = r.int(1, 4);
      for (let i = 0; i < n; i++) {
        const s = r.range(0.9, 1.5);
        parts.push({ geo: g.box, mat: mats.wood, m: M(r.range(-0.8, 0.8), s / 2 + (i > 1 ? 1.3 : 0), r.range(-0.8, 0.8), 0, r.range(-0.4, 0.4), 0, s) });
      }
      return parts;
    } },
    { name: 'tyres', radius: 1.0, bands: ['edge'], weight: 3, build: (r) => {
      const n = r.int(2, 5);
      return Array.from({ length: n }, (_, k) => ({ geo: g.tyre, mat: mats.rubber, m: M(r.range(-0.1, 0.1), 0.25 + k * 0.48, r.range(-0.1, 0.1)) }));
    } },
    { name: 'sandbags', radius: 2.2, bands: ['edge'], weight: 2, build: (r) => {
      const parts: Part[] = [];
      for (let row = 0; row < 3; row++)
        for (let i = 0; i < 4 - row; i++)
          parts.push({ geo: g.bag, mat: mats.sand, m: M(-1.6 + i * 1.05 + row * 0.5, 0.22 + row * 0.42, r.range(-0.05, 0.05), 0, r.range(-0.15, 0.15), 0) });
      return parts;
    } },
    { name: 'brazier', radius: 1.0, bands: ['edge', 'mid'], weight: 2, pool: ['#FF8A2A', 7], build: () => [
      { geo: g.cylLow, mat: mats.iron, m: M(0, 0.9, 0, 0, 0, 0, 0.7, 0.5, 0.7) },
      { geo: g.cylLow, mat: mats.dark, m: M(0, 0.4, 0, 0, 0, 0, 0.18, 0.8, 0.18) },
      { geo: g.flame, mat: mats.fire, m: M(0, 1.6, 0, 0, 0, 0, 1.1, 1, 1.1), shadow: false },
    ] },
    { name: 'scrapSmall', radius: 1.4, bands: ['edge', 'mid'], weight: 3, build: (r) => scrap(r, 4, 1.2) },
    { name: 'spikeFence', radius: 2.4, bands: ['edge'], weight: 2, build: (r) => {
      const parts: Part[] = [];
      for (let i = 0; i < 5; i++) {
        const x = -2 + i;
        parts.push({ geo: g.box, mat: mats.wood, m: M(x, 1, 0, 0, 0, r.range(-0.08, 0.08), 0.22, 2, 0.22) });
        parts.push({ geo: g.cone, mat: mats.ironLight, m: M(x, 2.3, 0, 0, 0, 0, 0.12, 0.6, 0.12) });
      }
      parts.push({ geo: g.box, mat: mats.wood, m: M(0, 1.3, 0.12, 0, 0, 0, 4.6, 0.18, 0.1) });
      parts.push({ geo: g.box, mat: mats.wood, m: M(0, 0.6, 0.12, 0, 0, 0, 4.6, 0.18, 0.1) });
      return parts;
    } },
    // ---- themed props (weights come from the barricade theme) -------------------
    { name: 'hedgehogs', radius: 2.2, bands: ['edge', 'mid'], weight: 1, build: (r) => {
      const parts: Part[] = [];
      const n = r.int(1, 3);
      for (let k = 0; k < n; k++) {
        const x = (k - (n - 1) / 2) * 2.1 + r.range(-0.2, 0.2);
        const yaw = r.range(0, Math.PI);
        for (const [rx, ry] of [[0.6, 0.6], [-0.6, 0.6], [0, -0.75]] as const)
          parts.push({ geo: g.box, mat: r.next() > 0.5 ? mats.iron : mats.rust, m: M(x, 0.9, r.range(-0.4, 0.4), rx, yaw + ry, 0, 0.22, 0.22, 2.4) });
      }
      return parts;
    } },
    { name: 'shack', radius: 3.4, bands: ['mid'], weight: 1, build: (r) => {
      const w = r.range(3.4, 4.6);
      const d = r.range(2.6, 3.4);
      const h = r.range(2.3, 3);
      return [
        { geo: g.box, mat: mats.ironLight, m: M(0, h / 2, 0, 0, 0, 0, w, h, d) },
        { geo: g.box, mat: mats.rust, m: M(0, h + 0.15, 0, 0, 0, r.range(0.06, 0.16), w + 0.7, 0.14, d + 0.7) },
        { geo: g.box, mat: mats.dark, m: M(-w * 0.2, 0.95, d / 2 + 0.02, 0, 0, 0, 0.9, 1.9, 0.08) },
        { geo: g.cylLow, mat: mats.iron, m: M(w * 0.3, h + 0.9, 0, 0, 0, 0, 0.18, 1.6, 0.18) },
        { geo: g.box, mat: mats.wood, m: M(w / 2 + 0.6, 0.45, 0, 0, r.range(-0.3, 0.3), 0, 0.9, 0.9, 0.9) },
      ];
    } },
    { name: 'bunker', radius: 2.9, bands: ['edge', 'mid'], weight: 1, build: (r) => {
      const parts: Part[] = [];
      for (let row = 0; row < 3; row++)
        for (let i = 0; i < 7; i++) {
          const a = -1.2 + (i + (row % 2) * 0.5) * 0.4;
          parts.push({ geo: g.bag, mat: mats.sand, m: M(Math.sin(a) * 2.1, 0.22 + row * 0.42, Math.cos(a) * 2.1 - 1, 0, a + r.range(-0.1, 0.1), 0) });
        }
      parts.push({ geo: g.box, mat: mats.wood, m: M(0, 0.5, -0.6, 0, r.range(-0.4, 0.4), 0, 1, 1, 1) });
      parts.push({ geo: g.box, mat: mats.rust, m: M(0, 1.55, 0.3, 0.12, 0, 0, 3.6, 0.12, 2.2) });
      return parts;
    } },
    { name: 'rocks', radius: 1.8, bands: ['edge', 'mid', 'far'], weight: 1, build: (r) => {
      const n = r.int(2, 4);
      return Array.from({ length: n }, () => {
        const s = r.range(0.5, 1.5);
        return { geo: g.sphere, mat: r.next() > 0.4 ? mats.sand : mats.dark, m: M(r.range(-1.2, 1.2), s * 0.3, r.range(-1.2, 1.2), r.range(-0.4, 0.4), r.range(0, 6), r.range(-0.4, 0.4), s, s * r.range(0.45, 0.8), s * r.range(0.7, 1.2)) };
      });
    } },
    { name: 'wireCoil', radius: 2.6, bands: ['edge', 'mid'], weight: 1, build: (r) => {
      const parts: Part[] = [];
      for (const x of [-2.2, 0, 2.2]) parts.push({ geo: g.box, mat: mats.wood, m: M(x, 0.8, 0, 0, 0, r.range(-0.12, 0.12), 0.16, 1.6, 0.16) });
      // Concertina wire: thin hoops standing across the run.
      for (let i = 0; i < 9; i++) parts.push({ geo: g.tyre, mat: mats.ironLight, m: M(-2 + i * 0.5, 0.75, r.range(-0.08, 0.08), 0, r.range(-0.2, 0.2), Math.PI / 2, 1, 0.25, 1), shadow: false });
      return parts;
    } },
    { name: 'wreck', radius: 3.0, bands: ['mid'], weight: 1, build: (r) => {
      const tilt = r.range(-0.25, 0.25);
      const parts: Part[] = [
        { geo: g.box, mat: mats.rust, m: M(0, 0.85, 0, 0, 0, tilt, 2, 1, 4.2) },
        { geo: g.box, mat: mats.dark, m: M(0, 1.6, -0.5, 0, 0, tilt, 1.6, 0.7, 1.8) },
        { geo: g.plate, mat: mats.iron, m: M(1.6, 0.2, 1, 0.3, r.range(0, 3), 0.2, 1.4, 1, 1) },
      ];
      for (const [x, z] of [[-1.1, 1.4], [1.1, 1.4], [-1.1, -1.4]] as const) parts.push({ geo: g.tyre, mat: mats.rubber, m: M(x, 0.55, z, 0, 0, Math.PI / 2, 1.1) });
      return parts;
    } },
    // ---- mid band -------------------------------------------------------------
    { name: 'boiler', radius: 3.2, bands: ['mid'], weight: 3, emitter: (r) => ({ local: new Vector3(1.2, 4.6, 0), opts: { kind: r.next() > 0.5 ? 'steam' : 'smoke', rate: 3, velocity: { x: 0, y: 2.6, z: 0 }, spread: 0.6, life: [2, 3.5], size: [1, 4] } }), build: () => [
      { geo: g.cyl, mat: mats.iron, m: M(0, 1.6, 0, 0, 0, Math.PI / 2, 1.3, 4, 1.3) },
      { geo: g.cyl, mat: mats.brass, m: M(-1.2, 1.6, 0, 0, 0, Math.PI / 2, 1.36, 0.2, 1.36) },
      { geo: g.cyl, mat: mats.brass, m: M(1.2, 1.6, 0, 0, 0, Math.PI / 2, 1.36, 0.2, 1.36) },
      { geo: g.cyl, mat: mats.rust, m: M(1.2, 3.5, 0, 0, 0, 0, 0.32, 2.2, 0.32) },
      { geo: g.sphere, mat: mats.brass, m: M(-1.5, 3.1, 0.4, 0, 0, 0, 0.4) },
      { geo: g.box, mat: mats.dark, m: M(0, 0.25, 0, 0, 0, 0, 4.4, 0.5, 2.4) },
    ] },
    { name: 'generator', radius: 2.6, bands: ['mid'], weight: 2, build: (r) => [
      { geo: g.box, mat: mats.rust, m: M(0, 1.3, 0, 0, 0, 0, 3.2, 2.6, 2.2) },
      { geo: g.box, mat: mats.grate, m: M(0, 1.4, 1.12, 0, 0, 0, 2.4, 1.6, 0.05) },
      { geo: g.cyl, mat: mats.iron, m: M(1.9, 2.0, 0, Math.PI / 2, 0, 0, 0.5, 2.6, 0.5) },
      { geo: g.gear, mat: mats.brass, m: M(-1.62, 1.6, 0, 0, 0, Math.PI / 2, 0.9) },
      { geo: g.cyl, mat: r.next() > 0.5 ? mats.neonCyan : mats.neonMagenta, m: M(0, 2.75, 0.8, 0, 0, Math.PI / 2, 0.08, 2.4, 0.08), shadow: false },
    ] },
    { name: 'pipes', radius: 3.5, bands: ['mid'], weight: 2, build: (r) => {
      const parts: Part[] = [];
      const h = r.range(1.5, 3.5);
      for (let i = 0; i < 3; i++) {
        parts.push({ geo: g.cyl, mat: i === 1 ? mats.brass : mats.rust, m: M(0, h + i * 0.9, 0, 0, 0, Math.PI / 2, 0.35, 7, 0.35) });
        for (const x of [-3, 3]) parts.push({ geo: g.cyl, mat: mats.dark, m: M(x, h + i * 0.9, 0, 0, 0, Math.PI / 2, 0.45, 0.25, 0.45) });
      }
      for (const x of [-2.6, 2.6]) parts.push({ geo: g.box, mat: mats.iron, m: M(x, (h + 2) / 2, 0, 0, 0, 0, 0.35, h + 2, 0.35) });
      return parts;
    } },
    { name: 'scrapPile', radius: 3.0, bands: ['mid', 'far'], weight: 3, build: (r) => scrap(r, 12, 2.6) },
    { name: 'bigGear', radius: 2.6, bands: ['mid'], weight: 2, build: (r) => [
      { geo: g.gear, mat: r.next() > 0.5 ? mats.rust : mats.brass, m: M(0, 2.0, 0, Math.PI / 2 - 0.35, 0, 0, 2.2) },
      { geo: g.box, mat: mats.dark, m: M(0, 0.4, 0.6, 0, 0, 0, 1.2, 0.8, 0.8) },
    ] },
    // ---- far band -------------------------------------------------------------
    { name: 'tank', radius: 6, bands: ['far'], weight: 3, build: (r) => {
      const h = r.range(7, 12);
      return [
        { geo: g.cyl, mat: mats.iron, m: M(0, h / 2, 0, 0, 0, 0, 5, h, 5) },
        { geo: g.sphere, mat: mats.rust, m: M(0, h, 0, 0, 0, 0, 5, 1.6, 5) },
        { geo: g.cyl, mat: mats.brass, m: M(0, h * 0.3, 0, 0, 0, 0, 5.15, 0.4, 5.15) },
        { geo: g.cyl, mat: mats.brass, m: M(0, h * 0.7, 0, 0, 0, 0, 5.15, 0.4, 5.15) },
        { geo: g.box, mat: mats.dark, m: M(0, h / 2, 5.05, 0, 0, 0, 0.6, h, 0.2) },
      ];
    } },
    { name: 'chimney', radius: 3, bands: ['far'], weight: 2, emitter: () => ({ local: new Vector3(0, 27, 0), opts: { kind: 'smoke', rate: 4, velocity: { x: 0, y: 3, z: 0 }, spread: 0.9, life: [4, 7], size: [3, 10] } }), build: () => [
      { geo: g.cyl, mat: mats.rust, m: M(0, 13, 0, 0, 0, 0, 1.8, 26, 1.8) },
      { geo: g.cyl, mat: mats.dark, m: M(0, 26.2, 0, 0, 0, 0, 2.1, 0.8, 2.1) },
      { geo: g.box, mat: mats.iron, m: M(0, 1.5, 0, 0, 0, 0, 5, 3, 5) },
    ] },
    { name: 'tower', radius: 4, bands: ['far'], weight: 2, build: (r) => {
      const h = r.range(12, 20);
      const parts: Part[] = [];
      for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) parts.push({ geo: g.box, mat: mats.iron, m: M(x, h / 2, z, 0, 0, 0, 0.4, h, 0.4) });
      for (let y = 3; y < h; y += 4) {
        parts.push({ geo: g.box, mat: mats.rust, m: M(0, y, -2, 0, 0, 0, 4.4, 0.3, 0.3) });
        parts.push({ geo: g.box, mat: mats.rust, m: M(0, y, 2, 0, 0, 0, 4.4, 0.3, 0.3) });
        parts.push({ geo: g.box, mat: mats.rust, m: M(-2, y, 0, 0, Math.PI / 2, 0, 4.4, 0.3, 0.3) });
        parts.push({ geo: g.box, mat: mats.rust, m: M(2, y, 0, 0, Math.PI / 2, 0, 4.4, 0.3, 0.3) });
      }
      parts.push({ geo: g.box, mat: mats.iron, m: M(0, h, 0, 0, 0, 0, 5, 1.6, 5) });
      parts.push({ geo: g.cyl, mat: mats.neonCyan, m: M(0, h + 0.3, 2.55, 0, 0, Math.PI / 2, 0.1, 4, 0.1), shadow: false });
      return parts;
    } },
  ];

  function scrap(r: Rng, n: number, spread: number): Part[] {
    const parts: Part[] = [];
    const choices = [mats.rust, mats.iron, mats.ironLight, mats.dark];
    for (let i = 0; i < n; i++) {
      const geo = r.pick([g.box, g.cyl, g.box, g.plate]);
      const s = r.range(0.4, 1.4);
      parts.push({
        geo,
        mat: r.pick(choices),
        m: M(r.range(-spread, spread) * 0.6, r.range(0.2, 0.3 + spread * 0.3), r.range(-spread, spread) * 0.6, r.range(-1, 1), r.range(0, 6), r.range(-1, 1), s, s * r.range(0.3, 1), s * r.range(0.5, 1.5)),
      });
    }
    return parts;
  }

  // --- Track proximity: sampled centre line. --------------------------------------
  const samples: Vector3[] = [];
  const SAMPLES = 700;
  for (let i = 0; i < SAMPLES; i++) samples.push(curve.getPointAt(i / SAMPLES));
  const distToTrack = (x: number, z: number) => {
    let d = Infinity;
    for (const p of samples) d = Math.min(d, (p.x - x) ** 2 + (p.z - z) ** 2);
    return Math.sqrt(d);
  };
  const placed: Reserved[] = [...reserved];
  const free = (x: number, z: number, r: number) => placed.every((o) => (o.x - x) ** 2 + (o.z - z) ** 2 > (o.r + r) ** 2);

  const bands: Record<Band, { min: number; max: number; step: number; density: number }> = {
    edge: { min: halfWidth + 1.8, max: halfWidth + 4.5, step: 3.2, density: tunables.get('dressing.edgeDensity') },
    mid: { min: halfWidth + 6, max: halfWidth + 18, step: 5.5, density: tunables.get('dressing.midDensity') },
    far: { min: halfWidth + 22, max: halfWidth + 55, step: 11, density: tunables.get('dressing.farDensity') },
  };

  const batches = new Map<string, { geo: BufferGeometry; mat: Material; list: Matrix4[]; shadow: boolean }>();
  const emitters: EmitterOptions[] = [];
  const pools: { x: number; y: number; z: number; r: number; color: string }[] = [];
  const length = curve.getLength();
  const up = new Vector3(0, 1, 0);

  for (const bandName of ['far', 'mid', 'edge'] as Band[]) {
    const band = bands[bandName];
    const candidates = props.filter((p) => p.bands.includes(bandName));
    const count = Math.floor((length / band.step) * band.density);
    for (let i = 0; i < count; i++) {
      const t = (i + rng.next()) / count;
      for (const side of [-1, 1]) {
        const p = curve.getPointAt(t);
        // The barricade on this side of the piece decides what is built behind it.
        const theme = themeOf(barricadeAt(p.x, p.z, side > 0));
        if (rng.next() > 0.85 * theme.density) continue; // leave gaps
        const weightOf = (d: PropDef) => d.weight * (theme.mul[d.name] ?? theme.other);
        let pick = rng.next() * candidates.reduce((s, d) => s + weightOf(d), 0);
        const def = candidates.find((d) => (pick -= weightOf(d)) < 0) ?? candidates[0]!;
        const left = new Vector3().crossVectors(up, curve.getTangentAt(t)).normalize();
        const off = side * rng.range(band.min + def.radius, band.max);
        const x = p.x + left.x * off;
        const z = p.z + left.z * off;
        if (distToTrack(x, z) < halfWidth + 1.2 + def.radius) continue; // never on the road (curves fold the bands)
        if (!free(x, z, def.radius)) continue;
        placed.push({ x, z, r: def.radius });
        const yaw = bandName === 'edge' ? Math.atan2(left.x, left.z) + rng.range(-0.3, 0.3) : rng.range(0, Math.PI * 2);
        const world = new Matrix4().compose(new Vector3(x, heightAt(x, z), z), new Quaternion().setFromAxisAngle(up, yaw), new Vector3(1, 1, 1));
        for (const part of def.build(rng)) {
          const key = `${part.geo.uuid}|${part.mat.uuid}`;
          let b = batches.get(key);
          if (!b) {
            b = { geo: part.geo, mat: part.mat, list: [], shadow: part.shadow !== false };
            batches.set(key, b);
          }
          b.list.push(world.clone().multiply(part.m));
        }
        if (def.emitter) {
          const e = def.emitter(rng);
          const w = e.local.clone().applyMatrix4(world);
          emitters.push({ ...e.opts, position: { x: w.x, y: w.y, z: w.z } });
        }
        if (def.pool) pools.push({ x, y: heightAt(x, z), z, r: def.pool[1], color: def.pool[0] });
      }
    }
  }

  // Ground debris: small plates and bolts scattered near the track (instanced, no outlines).
  const debrisCount = tunables.get('dressing.debris');
  const debris: Matrix4[] = [];
  for (let i = 0; i < debrisCount; i++) {
    const t = rng.next();
    const p = curve.getPointAt(t);
    const left = new Vector3().crossVectors(up, curve.getTangentAt(t)).normalize();
    const off = (rng.next() > 0.5 ? 1 : -1) * rng.range(halfWidth + 1.2, halfWidth + 24);
    const x = p.x + left.x * off;
    const z = p.z + left.z * off;
    const s = rng.range(0.15, 0.6);
    debris.push(M(x, heightAt(x, z) + 0.03, z, 0, rng.range(0, 6), 0, s, 1, s * rng.range(0.4, 1.2)));
  }
  batches.set('debris', { geo: g.plate, mat: mats.debris, list: debris, shadow: false });

  let instances = 0;
  for (const b of batches.values()) {
    if (!b.list.length) continue;
    const mesh = new InstancedMesh(b.geo, b.mat, b.list.length);
    b.list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.castShadow = b.shadow;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
    instances += b.list.length;
  }

  // Glow pools under braziers (one instanced additive mesh).
  if (pools.length) {
    const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    const d: N = uv().sub(0.5).length().mul(2);
    m.colorNode = vec4(new Color('#FF8A2A'), smoothstep(float(1), float(0), d).pow(2).mul(0.22)) as N;
    (m as N).fog = false;
    const geo = new PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mesh = new InstancedMesh(geo, m, pools.length);
    pools.forEach((p, i) => mesh.setMatrixAt(i, M(p.x, p.y + 0.07, p.z, 0, 0, 0, p.r * 2, 1, p.r * 2)));
    mesh.renderOrder = 5;
    scene.add(mesh);
  }

  return { emitters, instancedMeshes: batches.size, instances };
}
