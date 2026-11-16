/**
 * Tileset renderer (doc 05 §9, phase E4): each module tile rendered straight from above with the
 * game's ink pipeline (orthographic camera, no fog, no vignette or grain), then the board
 * markings drawn over it in 2D: squares (Grid or Lanes), edge band borders and barricade type,
 * travel arrow, hazard letters, piece number and level. Plus the layout sheet (the whole track
 * with the numbered modules). Loaded lazily by the tileset view.
 */
import { OrthographicCamera, RenderTarget, Vector3, WebGPURenderer } from 'three/webgpu';
import { tunables, type TunableValue } from '../core/tunables';
import { getBiome } from '../biomes';
import { InkPipeline } from '../render/pipeline';
import { SharedTex, U } from '../render/ink/ink-uniforms';
import { makeProceduralSet } from '../render/procedural/textures';
import { ParticleSystem } from '../render/fx/particles';
import { SparkSystem } from '../render/fx/sparks';
import { FeatureViews, type FeatureSource } from '../game/feature-views';
import { sampleAt, type CompiledTrack } from '../track/compile';
import type { HazardPhase } from '../track/track-format';
import { PRINT_SQUARE_CM, SQUARE } from '../track/units';
import { buildWorld } from '../world/build';
import { disposeScene } from '../world/kit';
import { BARRICADE_COLOR, HAZARD_LETTER } from './geometry';
import { BAND, type ModuleTile, type Seg, type SquareMode, roadOutline, squareLines } from './tileset';

/** Print resolution and bleed (doc 05 §9). */
export const DPI = 300;
export const BLEED_MM = 3;
/** Module size printed (mm): 8 squares of 2 cm. */
export const MODULE_MM = 8 * PRINT_SQUARE_CM * 10;
/** Metres per printed millimetre (1:125). */
const M_PER_MM = SQUARE / (PRINT_SQUARE_CM * 10);

export interface TilesetOptions {
  squares: SquareMode;
  seed: number;
  /** Pixels per tile side including the bleed (default: 300 dpi). */
  px?: number;
}

export interface RenderedTile {
  tile: ModuleTile;
  url: string;
}

export interface TilesetResult {
  tiles: RenderedTile[];
  layout: string;
  dispose(): void;
}

const pxFor = (mm: number) => Math.round((mm / 25.4) * DPI);

/** Tunables the print look changes (restored afterwards). */
const PRINT_LOOK: Record<string, TunableValue> = { 'post.vignette': 0, 'post.grain': 0, 'fog.density': 0 };

export async function renderTileset(
  track: CompiledTrack,
  modules: readonly ModuleTile[],
  opts: TilesetOptions,
  onProgress: (done: number, total: number) => void,
  cancelled: () => boolean,
): Promise<TilesetResult> {
  const sideMm = MODULE_MM + 2 * BLEED_MM;
  const px = opts.px ?? pxFor(sideMm);
  const halfM = (sideMm / 2) * M_PER_MM; // world half extent incl. bleed (10.375 m)
  const ppm = px / (2 * halfM);
  const cell = track.file.cell;

  const renderer = new WebGPURenderer({ antialias: true });
  await renderer.init();
  const flipRows = !(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend;
  // The pipeline draws into the renderer's current target: an offscreen one, read back per tile.
  let target = new RenderTarget(1, 1);
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  const tex = makeProceduralSet(opts.seed);
  SharedTex.tam = tex.tam;
  SharedTex.noise = tex.noise;
  SharedTex.paper = tex.paper;

  const world = buildWorld(getBiome(track.file.biome), tex, opts.seed, track, { rain: false });
  const saved: Record<string, TunableValue> = {};
  for (const [k, v] of Object.entries(PRINT_LOOK)) {
    saved[k] = tunables.get(k);
    tunables.set(k, v);
  }
  const scene = world.scene;
  // FeatureViews needs particle systems (vent jets); they are never updated, so nothing is drawn.
  const particles = new ParticleSystem(scene, tex.puff, 1);
  const sparks = new SparkSystem(scene, 1);
  const source = { track, clock: 0, features: { pickups: track.pickups.map(() => ({ active: true })), phases: track.hazards.map(() => 'idle' as HazardPhase) } };
  const features = new FeatureViews(scene, source as FeatureSource, tex, particles, sparks);
  features.update(0);
  world.keyLight.castShadow = true;
  world.keyLight.shadow.mapSize.set(2048, 2048);

  const top = track.bounds.maxY + 80;
  const camera = new OrthographicCamera(-halfM, halfM, halfM, -halfM, 1, 300);
  // North (+Z) up, the driver's right of a northbound piece (−X) on the right: like the grid.
  camera.up.set(0, 0, 1);
  const pipeline = new InkPipeline(renderer, scene, camera, { noise: tex.noise, paper: tex.paper });
  const out = document.createElement('canvas');
  const ctx = out.getContext('2d')!;
  const geo = {
    lines: squareLines(track, opts.squares),
    outline: roadOutline(track),
  };

  const shoot = async (cx: number, cz: number, half: number, size: number) => {
    renderer.setSize(size, size, false);
    if (target.width !== size) {
      target.dispose();
      target = new RenderTarget(size, size);
    }
    pipeline.updateResolution();
    // Line weight in metres as in a race view (~18 px per metre at 1080 p), not in pixels.
    U.resolutionScale.value = size / (2 * half) / 18;
    U.fogStart.value = 1e5;
    camera.left = camera.bottom = -half;
    camera.right = camera.top = half;
    camera.position.set(cx, top, cz);
    camera.lookAt(cx, top - 100, cz);
    camera.updateProjectionMatrix();
    world.update(0, new Vector3(cx, 0, cz));
    const sc = world.keyLight.shadow.camera;
    sc.left = sc.bottom = -Math.max(40, half * 1.5);
    sc.right = sc.top = Math.max(40, half * 1.5);
    sc.far = 400 + half * 4;
    sc.updateProjectionMatrix();
    // Passes render once per frame id, which only the renderer's animation loop advances (we have
    // none: rAF stalls in background tabs). Advance it by hand, as Animation does.
    const nodes = (renderer as unknown as { _nodes: { nodeFrame: { update(): void; frameId: number } } })._nodes;
    nodes.nodeFrame.update();
    (renderer.info as { frame: number }).frame = nodes.nodeFrame.frameId;
    renderer.setRenderTarget(target);
    pipeline.render();
    renderer.setRenderTarget(null);
    const raw = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, size, size)) as Uint8Array;
    out.width = out.height = size;
    const img = ctx.createImageData(size, size);
    // WebGPU pads rows to 256 bytes; WebGL reads bottom-up.
    const row = size * 4;
    const stride = raw.length / size;
    for (let y = 0; y < size; y++) {
      const src = (flipRows ? size - 1 - y : y) * stride;
      img.data.set(raw.subarray(src, src + row), y * row);
    }
    ctx.putImageData(img, 0, 0);
  };

  const urls: string[] = [];
  const toUrl = async () => {
    const blob = await new Promise<Blob>((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('Cannot encode the tile image'))), 'image/jpeg', 0.92));
    const url = URL.createObjectURL(blob);
    urls.push(url);
    return url;
  };

  const restore = () => {
    for (const [k, v] of Object.entries(saved)) tunables.set(k, v);
  };

  try {
    await pipeline.compileAsync();
    // Warm-up frame (first frames can miss async uploads).
    await shoot(modules[0] ? (modules[0].cx + 0.5) * cell : 0, modules[0] ? (modules[0].cz + 0.5) * cell : 0, halfM, 256);
    await nextFrame();

    const tiles: RenderedTile[] = [];
    for (let i = 0; i < modules.length; i++) {
      if (cancelled()) throw new Error('cancelled');
      const m = modules[i]!;
      const cx = (m.cx + 0.5) * cell;
      const cz = (m.cz + 0.5) * cell;
      await shoot(cx, cz, halfM, px);
      const map = mapper(cx, cz, halfM, ppm);
      drawSquares(ctx, map, geo, ppm);
      drawMarks(ctx, track, m, map, ppm, cell);
      tiles.push({ tile: m, url: await toUrl() });
      onProgress(i + 1, modules.length + 1);
      await nextFrame();
    }

    // Layout sheet: the whole track, modules outlined and numbered.
    const b = track.bounds;
    const lcx = (b.minX + b.maxX) / 2;
    const lcz = (b.minZ + b.maxZ) / 2;
    const lhalf = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + cell;
    const lsize = 2400;
    await shoot(lcx, lcz, lhalf, lsize);
    drawLayout(ctx, modules, mapper(lcx, lcz, lhalf, lsize / (2 * lhalf)), cell, track.file.name);
    const layout = await toUrl();
    onProgress(modules.length + 1, modules.length + 1);

    return {
      tiles,
      layout,
      dispose: () => urls.forEach((u) => URL.revokeObjectURL(u)),
    };
  } catch (e) {
    urls.forEach((u) => URL.revokeObjectURL(u));
    throw e;
  } finally {
    restore();
    pipeline.dispose();
    target.dispose();
    world.keyLight.shadow.map?.dispose();
    world.dispose();
    disposeScene(scene, new Set());
    for (const v of Object.values(tex)) {
      if (Array.isArray(v)) v.forEach((t) => t.dispose?.());
      else (v as { dispose?: () => void } | null)?.dispose?.();
    }
    renderer.dispose();
  }
}

/** Yield to the page between tiles (progress, Stop). Not rAF: it stalls in background tabs. */
const nextFrame = () =>
  new Promise<void>((r) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => r();
    ch.port2.postMessage(0);
  });

/** World (x, z) → image pixels: north (+Z) up, −X to the right. */
type Map2 = (x: number, z: number) => [number, number];
function mapper(cx: number, cz: number, half: number, ppm: number): Map2 {
  return (x, z) => [(cx + half - x) * ppm, (cz + half - z) * ppm];
}

function ring(ctx: CanvasRenderingContext2D, pts: [number, number][], map: Map2): void {
  pts.forEach(([x, z], i) => {
    const [u, v] = map(x, z);
    if (i) ctx.lineTo(u, v);
    else ctx.moveTo(u, v);
  });
  ctx.closePath();
}

function segs(ctx: CanvasRenderingContext2D, list: Seg[], map: Map2): void {
  ctx.beginPath();
  for (const [x0, z0, x1, z1] of list) {
    const [a, b] = map(x0, z0);
    const [c, d] = map(x1, z1);
    ctx.moveTo(a, b);
    ctx.lineTo(c, d);
  }
  ctx.stroke();
}

function drawSquares(ctx: CanvasRenderingContext2D, map: Map2, geo: { lines: { along: Seg[]; cross: Seg[] }; outline: { left: [number, number][]; right: [number, number][] } }, ppm: number): void {
  // Double stroke (dark ink, light core): readable on dark and light surfaces, and never mistaken
  // for the seams painted in the road textures.
  const stroke = (list: Seg[]) => {
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(20, 12, 10, 0.85)';
    ctx.lineWidth = Math.max(2, 0.16 * ppm);
    segs(ctx, list, map);
    ctx.strokeStyle = 'rgba(255, 244, 222, 0.8)';
    ctx.lineWidth = Math.max(1, 0.05 * ppm);
    segs(ctx, list, map);
  };
  ctx.save();
  // Cross lines only on the road band: clip to the area between the two borders (even-odd).
  ctx.beginPath();
  ring(ctx, geo.outline.left, map);
  ring(ctx, geo.outline.right, map);
  ctx.clip('evenodd');
  stroke(geo.lines.cross);
  ctx.restore();
  ctx.save();
  stroke(geo.lines.along);
  ctx.restore();
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, align: CanvasTextAlign = 'left'): void {
  ctx.font = `bold ${size}px "Trebuchet MS", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  const w = ctx.measureText(text).width;
  const pad = size * 0.25;
  const x0 = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  ctx.fillStyle = 'rgba(27, 18, 16, 0.85)';
  ctx.fillRect(x0 - pad, y - pad, w + pad * 2, size + pad * 2);
  ctx.fillStyle = '#F4E8D0';
  ctx.fillText(text, x0, y);
}

/** Travel arrow, edge band types, hazard letters, number and level of one module. */
function drawMarks(ctx: CanvasRenderingContext2D, track: CompiledTrack, m: ModuleTile, map: Map2, ppm: number, cell: number): void {
  const inCell = track.samples.filter((p) => p.piece === m.piece && Math.floor(p.x / cell) === m.cx && Math.floor(p.z / cell) === m.cz);
  const mid = inCell[Math.floor(inCell.length / 2)];
  if (mid) {
    // Arrow along the travel direction at the centre line.
    const [u, v] = map(mid.x, mid.z);
    const [u2, v2] = map(mid.x + mid.tx, mid.z + mid.tz);
    const a = Math.atan2(v2 - v, u2 - u);
    ctx.save();
    ctx.translate(u, v);
    ctx.rotate(a);
    const L = 2.2 * ppm;
    ctx.strokeStyle = 'rgba(255, 248, 230, 0.9)';
    ctx.fillStyle = 'rgba(255, 248, 230, 0.9)';
    ctx.lineWidth = 0.35 * ppm;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-L / 2, 0);
    ctx.lineTo(L / 2 - 0.6 * ppm, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(L / 2, 0);
    ctx.lineTo(L / 2 - 0.9 * ppm, -0.7 * ppm);
    ctx.lineTo(L / 2 - 0.9 * ppm, 0.7 * ppm);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Barricade type on each edge band (driver's left / right), small tag with its colour.
    for (const side of [-1, 1] as const) {
      const type = side < 0 ? mid.left : mid.right;
      const lat = side * (BAND - 1.25);
      const [bu, bv] = map(mid.x - mid.tz * lat, mid.z + mid.tx * lat);
      const size = Math.round(0.55 * ppm);
      ctx.font = `bold ${size}px "Trebuchet MS", sans-serif`;
      const w = ctx.measureText(type).width + size;
      ctx.fillStyle = 'rgba(27, 18, 16, 0.85)';
      ctx.fillRect(bu - w / 2, bv - size * 0.8, w, size * 1.6);
      ctx.fillStyle = BARRICADE_COLOR[type] ?? '#ccc';
      ctx.fillRect(bu - w / 2, bv - size * 0.8, size * 0.4, size * 1.6);
      ctx.fillStyle = '#F4E8D0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(type, bu + size * 0.2, bv);
    }
  }
  // Hazards whose zone centre falls in this module: their letter.
  for (const h of track.hazards) {
    const p = sampleAt(track, (h.s0 + h.s1) / 2);
    const lat = (h.lat0 + h.lat1) / 2;
    const x = p.x - p.tz * lat;
    const z = p.z + p.tx * lat;
    if (Math.floor(x / cell) !== m.cx || Math.floor(z / cell) !== m.cz) continue;
    const [u, v] = map(x, z);
    const r = 0.9 * ppm;
    ctx.fillStyle = '#F0C050';
    ctx.strokeStyle = '#1B1210';
    ctx.lineWidth = 0.12 * ppm;
    ctx.beginPath();
    ctx.arc(u, v, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1B1210';
    ctx.font = `bold ${Math.round(r * 1.2)}px "Trebuchet MS", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(HAZARD_LETTER[h.kind], u, v + r * 0.05);
  }
  // Number (top left, inside the trim) and level (top right).
  const inset = (BLEED_MM * M_PER_MM + 0.3) * ppm;
  const size = Math.round(0.8 * ppm);
  label(ctx, m.label, inset, inset, size);
  if (m.level) label(ctx, `L${m.level > 0 ? '+' : ''}${m.level}`, ctx.canvas.width - inset, inset, size, 'right');
}

function drawLayout(ctx: CanvasRenderingContext2D, modules: readonly ModuleTile[], map: Map2, cell: number, name: string): void {
  const [ux0] = map(0, 0);
  const [ux1] = map(cell, 0);
  const s = Math.abs(ux1 - ux0);
  ctx.save();
  ctx.lineWidth = Math.max(2, s * 0.02);
  for (const m of modules) {
    // Cell corners: the mapping flips X, so take the min of both corners.
    const [a, b] = map(m.cx * cell, m.cz * cell);
    const [c, d] = map((m.cx + 1) * cell, (m.cz + 1) * cell);
    const x = Math.min(a, c);
    const y = Math.min(b, d);
    ctx.strokeStyle = 'rgba(255, 248, 230, 0.85)';
    ctx.strokeRect(x, y, s, s);
    ctx.fillStyle = 'rgba(27, 18, 16, 0.75)';
    const fs = Math.max(10, Math.round(s * 0.16));
    ctx.font = `bold ${fs}px "Trebuchet MS", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = m.parts > 1 ? `${m.piece + 1}·${m.part}` : `${m.piece + 1}`;
    const w = ctx.measureText(text).width + fs * 0.5;
    ctx.fillRect(x + s / 2 - w / 2, y + s / 2 - fs * 0.7, w, fs * 1.4);
    ctx.fillStyle = '#F4E8D0';
    ctx.fillText(text, x + s / 2, y + s / 2);
  }
  ctx.restore();
  label(ctx, `${name} · ${modules.length} modules`, 24, 24, 40);
}
