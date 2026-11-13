/**
 * Procedural textures for the look test (doc 02 §4.1, §6, §9, §11). Seeded and tileable.
 * Painted with Canvas 2D at boot; replaced by artist textures / KTX2 later.
 */
import {
  CanvasTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  UnsignedByteType,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three/webgpu';
import { Rng } from '../../core/rng';
import { TAM_LEVELS, generateStrokes } from './strokes';

type Ctx = CanvasRenderingContext2D;

function canvas(size: number, h = size): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D unavailable');
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement, color: boolean, repeat = true): Texture {
  const t = new CanvasTexture(c);
  t.colorSpace = color ? SRGBColorSpace : NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Draw `fn` 9 times shifted by ±size so shapes crossing an edge wrap around (tileable). */
function wrapped(size: number, x: number, y: number, fn: (x: number, y: number) => void): void {
  for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) fn(x + ox, y + oy);
}

/** Tapered pen stroke: pointed ends, full width in the middle. */
function penStroke(ctx: Ctx, x: number, y: number, len: number, angle: number, width: number): void {
  const dx = (Math.cos(angle) * len) / 2;
  const dy = (Math.sin(angle) * len) / 2;
  const nx = (-Math.sin(angle) * width) / 2;
  const ny = (Math.cos(angle) * width) / 2;
  ctx.beginPath();
  ctx.moveTo(x - dx, y - dy);
  ctx.quadraticCurveTo(x + nx * 2, y + ny * 2, x + dx, y + dy);
  ctx.quadraticCurveTo(x - nx * 2, y - ny * 2, x - dx, y - dy);
  ctx.fill();
}

/**
 * Tonal Art Map: R/G/B/A = stroke coverage of hatch levels 1..4 (1 = ink).
 * Packed into a DataTexture: a canvas would premultiply RGB by A and lose levels 1–3.
 */
export function makeTAM(seed: number, size = 512): Texture {
  const data = new Uint8Array(size * size * 4);
  TAM_LEVELS.forEach((level, ch) => {
    const [, ctx] = canvas(size);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    for (const s of generateStrokes(seed * 31 + ch, level)) {
      ctx.fillStyle = `rgba(255,255,255,${s.opacity})`;
      wrapped(size, s.x * size, s.y * size, (x, y) => penStroke(ctx, x, y, s.length * size, s.angle, s.width));
    }
    const d = ctx.getImageData(0, 0, size, size).data;
    for (let i = 0; i < size * size; i++) data[i * 4 + ch] = d[i * 4]!;
  });
  const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  t.colorSpace = NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** Smooth tileable value noise; R and G are independent channels (used for line wobble). */
export function makeNoise(seed: number, size = 256, cells = 8): Texture {
  const rng = new Rng(seed);
  const grid = (n: number) => Array.from({ length: n * n }, () => rng.next());
  const gr = grid(cells);
  const gg = grid(cells);
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size);
  const sample = (g: number[], x: number, y: number) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (i: number, j: number) => g[((j % cells) + cells) % cells * cells + (((i % cells) + cells) % cells)]!;
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const u = (x / size) * cells, v = (y / size) * cells;
      img.data[i] = sample(gr, u, v) * 255;
      img.data[i + 1] = sample(gg, u, v) * 255;
      img.data[i + 2] = 0;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, false);
}

/** Paper fibre texture, grey around 0.5 (applied as a subtle multiply in post). */
export function makePaper(seed: number, size = 512): Texture {
  const rng = new Rng(seed);
  const [c, ctx] = canvas(size);
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < size * size; i++) {
    const n = (rng.next() - 0.5) * 36;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 128 + n;
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 1400; i++) {
    const light = rng.next() > 0.5;
    ctx.strokeStyle = light ? `rgba(255,255,255,${rng.range(0.05, 0.18)})` : `rgba(0,0,0,${rng.range(0.04, 0.12)})`;
    ctx.lineWidth = rng.range(0.5, 1.4);
    const x = rng.next() * size, y = rng.next() * size, a = rng.next() * Math.PI, l = rng.range(4, 22);
    wrapped(size, x, y, (px, py) => {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + Math.cos(a + 0.5) * l * 0.5, py + Math.sin(a + 0.5) * l * 0.5, px + Math.cos(a) * l, py + Math.sin(a) * l);
      ctx.stroke();
    });
  }
  return toTexture(c, false);
}

// --- Painted albedo textures (foundry palette, doc 02 §12) ------------------------

const INK = '#1B1210';

function blotches(ctx: Ctx, rng: Rng, size: number, n: number, colors: string[], rMin: number, rMax: number, alpha: [number, number]): void {
  for (let i = 0; i < n; i++) {
    const x = rng.next() * size, y = rng.next() * size;
    const r = rng.range(rMin, rMax);
    const col = rng.pick(colors);
    const a = rng.range(alpha[0], alpha[1]);
    wrapped(size, x, y, (px, py) => {
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, hexA(col, a));
      g.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(px, py, r, r * rng.range(0.5, 1), rng.next() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function speckle(ctx: Ctx, rng: Rng, size: number, n: number, color: string, maxR: number, alpha: number): void {
  ctx.fillStyle = hexA(color, alpha);
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.arc(rng.next() * size, rng.next() * size, rng.range(0.4, maxR), 0, Math.PI * 2);
    ctx.fill();
  }
}

function rivet(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.fillStyle = '#6E655E';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.2, r * 0.45);
  ctx.stroke();
  ctx.fillStyle = 'rgba(230,215,190,0.55)';
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
}

function scratches(ctx: Ctx, rng: Rng, size: number, n: number): void {
  for (let i = 0; i < n; i++) {
    ctx.strokeStyle = rng.next() > 0.4 ? hexA(INK, rng.range(0.25, 0.6)) : 'rgba(200,185,165,0.25)';
    ctx.lineWidth = rng.range(0.6, 1.6);
    const x = rng.next() * size, y = rng.next() * size, a = rng.next() * Math.PI * 2, l = rng.range(6, 40);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
}

/** Riveted floor plates: 3×3 plates per tile, chunky ink seams and rivets (readable at ~25 px/m). */
export function makePlates(seed: number, size = 1024): Texture {
  const rng = new Rng(seed);
  const [c, ctx] = canvas(size);
  const n = 3;
  const p = size / n;
  const tones = ['#7A6A5E', '#73635A', '#827062', '#6E6058', '#7C6A5A'];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = rng.pick(tones);
      ctx.fillRect(i * p, j * p, p, p);
    }
  blotches(ctx, rng, size, 45, ['#8A5532', '#9A6038', '#7A4A2E'], 30, 120, [0.3, 0.6]); // rust
  blotches(ctx, rng, size, 22, ['#2A201C', '#3A2C24'], 30, 100, [0.35, 0.6]); // oil/grime
  speckle(ctx, rng, size, 2200, '#3A2C24', 2.2, 0.35);
  speckle(ctx, rng, size, 700, '#B07040', 1.8, 0.3);
  scratches(ctx, rng, size, 120);
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(215,195,165,0.4)'; // edge wear highlight
  for (let k = 0; k <= n; k++) {
    ctx.beginPath();
    ctx.moveTo(k * p + 7, 0);
    ctx.lineTo(k * p + 7, size);
    ctx.moveTo(0, k * p + 7);
    ctx.lineTo(size, k * p + 7);
    ctx.stroke();
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 9;
  for (let k = 0; k <= n; k++) {
    ctx.beginPath();
    ctx.moveTo(k * p, 0);
    ctx.lineTo(k * p, size);
    ctx.moveTo(0, k * p);
    ctx.lineTo(size, k * p);
    ctx.stroke();
  }
  const per = 6;
  const step = p / per;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++)
      for (let k = 1; k < per; k++) {
        rivet(ctx, i * p + k * step, j * p + 22, 10);
        rivet(ctx, i * p + 22, j * p + k * step, 10);
      }
  return toTexture(c, true);
}

/** Metal floor grate: dark pit, iron bars with ink edges. */
export function makeGrate(seed: number, size = 512): Texture {
  const rng = new Rng(seed);
  const [c, ctx] = canvas(size);
  ctx.fillStyle = '#16100E';
  ctx.fillRect(0, 0, size, size);
  const bars = 10;
  const w = size / bars;
  for (let i = 0; i < bars; i++) {
    ctx.fillStyle = rng.pick(['#4E4642', '#564C46', '#4A403B']);
    ctx.fillRect(i * w + w * 0.3, 0, w * 0.4, size);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(i * w + w * 0.3, -2, w * 0.4, size + 4);
  }
  for (let j = 0; j < 2; j++) {
    ctx.fillStyle = '#5A514B';
    ctx.fillRect(0, j * (size / 2) + size / 4 - 10, size, 20);
    ctx.strokeRect(-2, j * (size / 2) + size / 4 - 10, size + 4, 20);
  }
  blotches(ctx, rng, size, 20, ['#7A4A2E'], 15, 60, [0.2, 0.5]);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 6;
  ctx.strokeRect(0, 0, size, size);
  return toTexture(c, true);
}

/** Packed dirt with pebbles, tyre marks and a few dry grass tufts. */
export function makeDirt(seed: number, size = 512): Texture {
  const rng = new Rng(seed);
  const [c, ctx] = canvas(size);
  ctx.fillStyle = '#4A3B2F';
  ctx.fillRect(0, 0, size, size);
  blotches(ctx, rng, size, 50, ['#3A2D24', '#5A4838', '#30261F'], 20, 80, [0.3, 0.6]);
  speckle(ctx, rng, size, 1800, '#2E241D', 2.2, 0.5);
  speckle(ctx, rng, size, 700, '#8C7458', 1.8, 0.45);
  for (let i = 0; i < 40; i++) {
    const x = rng.next() * size, y = rng.next() * size, r = rng.range(2, 6);
    ctx.fillStyle = rng.pick(['#6E655E', '#7A6A58']);
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.7, rng.next() * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(80,95,50,0.7)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 30; i++) {
    const x = rng.next() * size, y = rng.next() * size;
    for (let k = 0; k < 6; k++) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + rng.range(-6, 6), y - rng.range(4, 10));
      ctx.stroke();
    }
  }
  return toTexture(c, true);
}

/** Vertical riveted panels for walls, boilers, barriers. `base` picks the tone. */
export function makePanels(seed: number, base: 'iron' | 'rust' | 'brass', size = 512): Texture {
  const rng = new Rng(seed);
  const [c, ctx] = canvas(size);
  const tones = {
    iron: ['#3A3330', '#423A36', '#36302D'],
    rust: ['#7A4A2E', '#6E4229', '#84502F'],
    brass: ['#B08A4A', '#A47E42', '#BC9450'],
  }[base];
  const cols = 4;
  const w = size / cols;
  for (let i = 0; i < cols; i++) {
    ctx.fillStyle = rng.pick(tones);
    ctx.fillRect(i * w, 0, w, size);
  }
  if (base !== 'brass') blotches(ctx, rng, size, 30, base === 'iron' ? ['#7A4A2E', '#2A201C'] : ['#A8663A', '#4A2C1C'], 15, 70, [0.2, 0.5]);
  else blotches(ctx, rng, size, 20, ['#5E6A4A', '#7A5A2E'], 10, 40, [0.2, 0.45]); // patina
  speckle(ctx, rng, size, 900, '#1E1614', 1.4, 0.35);
  scratches(ctx, rng, size, 50);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  for (let i = 0; i <= cols; i++) {
    ctx.beginPath();
    ctx.moveTo(i * w, 0);
    ctx.lineTo(i * w, size);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(0, size / 2);
  ctx.lineTo(size, size / 2);
  ctx.stroke();
  for (let i = 0; i < cols; i++)
    for (let k = 0; k < 10; k++) {
      rivet(ctx, i * w + 9, (k + 0.5) * (size / 10), 3.5);
      rivet(ctx, (i + 1) * w - 9, (k + 0.5) * (size / 10), 3.5);
    }
  return toTexture(c, true);
}

/** Steam puff sprite: soft white cloud with a painted ink rim (doc 02 §9). Alpha in A. */
export function makePuff(seed: number, size = 256): Texture {
  const rng = new Rng(seed);
  const [c, ctx] = canvas(size);
  const blobs = Array.from({ length: 7 }, () => ({
    x: size / 2 + rng.range(-0.18, 0.18) * size,
    y: size / 2 + rng.range(-0.14, 0.14) * size,
    r: rng.range(0.16, 0.25) * size,
  }));
  // Ink rim: draw the union slightly larger in ink, then the white body on top.
  ctx.fillStyle = hexA(INK, 0.85);
  for (const b of blobs) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r + 4, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const b of blobs) {
    const g = ctx.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.1, b.x, b.y, b.r);
    g.addColorStop(0, '#FFFFFF');
    g.addColorStop(1, '#C9C2B8');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }
  // A few interior ink curls.
  ctx.strokeStyle = hexA(INK, 0.5);
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const b = rng.pick(blobs);
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 0.6, rng.range(3.5, 4.5), rng.range(5, 6));
    ctx.stroke();
  }
  // Fade the outer border so sprites never show a square edge.
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createRadialGradient(size / 2, size / 2, size * 0.36, size / 2, size / 2, size * 0.5);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size, size);
  return toTexture(c, true, false);
}

/** Banner cloth with a simple emblem (identity, doc 02 §13.1); white so it can be tinted. */
export function makeBanner(seed: number, size = 128): Texture {
  const rng = new Rng(seed);
  const [c, ctx] = canvas(size, size * 1.25);
  const h = size * 1.25;
  ctx.fillStyle = '#E8E2D6';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(size, 0);
  ctx.lineTo(size, h * 0.82);
  ctx.lineTo(size / 2, h);
  ctx.lineTo(0, h * 0.82);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.stroke();
  // Gear emblem.
  ctx.save();
  ctx.translate(size / 2, h * 0.42);
  ctx.fillStyle = INK;
  const teeth = 8;
  for (let i = 0; i < teeth; i++) {
    ctx.rotate((Math.PI * 2) / teeth);
    ctx.fillRect(-5, -size * 0.3, 10, 12);
  }
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  speckle(ctx, rng, size, 120, '#6E655E', 1.5, 0.3);
  return toTexture(c, true, false);
}

export interface ProceduralSet {
  tam: Texture;
  noise: Texture;
  paper: Texture;
  plates: Texture;
  grate: Texture;
  dirt: Texture;
  iron: Texture;
  rust: Texture;
  brass: Texture;
  puff: Texture;
  banner: Texture;
}

export function makeProceduralSet(seed: number): ProceduralSet {
  return {
    tam: makeTAM(seed),
    noise: makeNoise(seed + 1),
    paper: makePaper(seed + 2),
    plates: makePlates(seed + 3),
    grate: makeGrate(seed + 4),
    dirt: makeDirt(seed + 5),
    iron: makePanels(seed + 6, 'iron'),
    rust: makePanels(seed + 7, 'rust'),
    brass: makePanels(seed + 8, 'brass'),
    puff: makePuff(seed + 9),
    banner: makeBanner(seed + 10),
  };
}
