/**
 * Victorian industrial city — *Cinderholme Grand Station* (doc 04 §7.2). Overcast dusk, smog and
 * drizzle; the only world without runes: all light is warm gas light and furnace. Orderly street
 * grid: brick terraces with lit windows, gas lamps at a regular spacing along the kerbs, bunting
 * across the road, smokestacks, gasometers, airships, the canal under the humped bridge, the
 * railway yard and the domed Grand Station with its clock rose window.
 */
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  PlaneGeometry,
  PointLight,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
} from 'three/webgpu';
import { tunables } from '../core/tunables';
import type { Part, PropDef, PropKit } from '../game/dressing';
import type { InkLitMaterial } from '../render/ink/ink-material';
import type { BiomeDef, WorldContext } from '../world/biome';
import { Batch, T, W, alongTrack, heightLimit, besideExact, crowd, glowPools, inZones, isFree, paint, ringAround, zoneRanges } from './common';

const P = {
  ink: '#1A1310',
  soot: '#3A322C',
  brick: '#7A3E2E',
  slate: '#4A5058',
  verdigris: '#5E8A7A',
  cobble: '#5A524A',
  gaslight: '#FFC46A',
  furnace: '#FF8A2A',
  fog: '#4A443E',
};

/** Original crest (doc 04 §7.2): a crowned cogwheel between two hammers. */
function crestTexture(bg: string, fg: string) {
  return paint(256, 384, (c) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, 256, 384);
    c.strokeStyle = '#1A1310';
    c.lineWidth = 10;
    c.strokeRect(0, 0, 256, 384);
    c.translate(128, 200);
    c.fillStyle = fg;
    c.strokeStyle = fg;
    c.lineWidth = 10;
    // Cogwheel.
    c.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r = i % 2 ? 62 : 74;
      c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    c.closePath();
    c.stroke();
    c.beginPath();
    c.arc(0, 0, 24, 0, Math.PI * 2);
    c.stroke();
    // Two crossed hammers behind it.
    for (const s of [-1, 1]) {
      c.save();
      c.rotate(s * 0.7);
      c.fillRect(-5, -110, 10, 150);
      c.fillRect(-24, -120, 48, 22);
      c.restore();
    }
    // Crown on top.
    c.beginPath();
    c.moveTo(-40, -86);
    c.lineTo(-40, -120);
    c.lineTo(-20, -100);
    c.lineTo(0, -128);
    c.lineTo(20, -100);
    c.lineTo(40, -120);
    c.lineTo(40, -86);
    c.closePath();
    c.fill();
  });
}

export const VICTORIAN: BiomeDef = {
  id: 'victorian',
  name: 'Cinderholme Grand Station',
  tunables: {
    'fog.color': P.fog,
    'fog.density': 0.011,
    'fog.start': 42,
    'fog.heightFalloff': 0.1,
    'light.keyColor': '#B8A898',
    'light.keyIntensity': 3.4,
    'light.keyPitch': 42,
    'light.keyYaw': 160,
    'light.skyColor': '#6A625A',
    'light.groundColor': '#2A2420',
    'light.ambient': 2.7,
    'light.furnaceIntensity': 520,
    'light.furnaceRange': 20,
    'ink.color': P.ink,
    'ink.shadowColor': '#2E2622',
    'ink.litTint': '#FFE8C8',
    'post.lift': '#16100C',
    'post.gain': '#FFEAD0',
    'post.saturation': 0.82,
    'post.vignette': 0.36,
    'post.bloomStrength': 0.7,
    'fx.wind': 1.6,
  },
  ground: { tex: 'cobble', tint: '#6E665E', scale: 1 / 6 },
  surfaces: {
    cobble: { tex: 'cobble', scale: 1.5, tint: '#A49888', sheen: 0.5 },
    flagstone: { tex: 'flagstone', scale: 1, tint: '#B4ACA0' },
    rails: { tex: 'rails', scale: 1, tint: '#A49A90' },
  },
  skirt: { tex: 'brick', tint: '#B07A68', scale: 0.25 },
  gantry: { lines: ['CINDERHOLME'], bg: '#5E8A7A', fg: '#F0E2C8' },
  clearView: true,
  pit: 'dark',
  rain: { color: '#C8C0B8', count: 900, speed: 20 },
  debris: { color: '#3A322C', scale: 0.5 },
  theme: { density: 1, other: 0, own: 1, mul: { barrel: 1, crates: 1.5 } },
  themes: {
    ironrail: { density: 1, other: 0, own: 1, mul: { barrel: 0.8, crates: 1, marketStall: 2, pillarBox: 1.5, bench: 1.5, coalHeap: 0.5 } },
    sandbags: { density: 1, other: 0, own: 1, mul: { sandbags: 3, crates: 2, barrel: 1.5, marketStall: 0.5, coalHeap: 1 } },
    corrugated: { density: 1, other: 0, own: 1, mul: { crates: 2.5, barrel: 2, coalHeap: 3, wagon: 3, shack: 2, marketStall: 0, bench: 0, pillarBox: 0 } },
  },
  props,
  decorate,
  landmark(ctx, lm) {
    if (lm.id !== 'grand-station') return false;
    grandStation(ctx, lm.x, lm.z, lm.facing, lm.r);
    return true;
  },
};

function props(k: PropKit): PropDef[] {
  const { M, g, ink, tex } = k;
  const brick = ink({ map: tex.brick, mapping: 'world', mapScale: 0.25, color: '#C8907A' });
  const soot = ink({ map: tex.brick, mapping: 'world', mapScale: 0.25, color: '#6A5A50' });
  const slate = ink({ color: P.slate });
  const red = ink({ color: '#A02A22', sheen: 0.4 });
  const canvasMat = ink({ color: '#C8B898' });
  const stripe = ink({ color: '#8A2A22' });
  const coal = ink({ color: '#2A2420', lineWeight: 0.3 });
  const iron = ink({ color: '#3A3634', sheen: 0.4 });
  const gasHolder = ink({ color: '#5A6058' });
  const gas = ink({ color: '#000000', emissive: P.gaslight, emissiveIntensity: 2.2, emissivePreset: 'fire', hatch: false, lineWeight: 0.2 });
  return [
    { name: 'marketStall', radius: 2.2, bands: ['edge', 'mid'], weight: 2, build: (r) => [
      { geo: g.box, mat: k.mats.wood, m: M(0, 0.5, 0, 0, 0, 0, 3, 1, 1.6) },
      ...[-1.4, 1.4].flatMap((x) => [-0.7, 0.7].map((z) => ({ geo: g.box, mat: k.mats.wood, m: M(x, 1.2, z, 0, 0, 0, 0.12, 2.4, 0.12) }))),
      { geo: g.box, mat: r.next() > 0.5 ? stripe : canvasMat, m: M(0, 2.5, 0.2, 0.25, 0, 0, 3.4, 0.08, 2.2) },
      ...Array.from({ length: 3 }, (_, i) => ({ geo: g.sphere, mat: r.pick([red, canvasMat, k.mats.brass]), m: M(-0.9 + i * 0.9, 1.15, 0, 0, 0, 0, 0.3) })),
    ] },
    { name: 'pillarBox', radius: 0.8, bands: ['edge'], weight: 1, build: () => [
      { geo: g.cyl, mat: red, m: M(0, 0.8, 0, 0, 0, 0, 0.35, 1.6, 0.35) },
      { geo: g.sphere, mat: red, m: M(0, 1.6, 0, 0, 0, 0, 0.38, 0.22, 0.38) },
    ] },
    { name: 'bench', radius: 1.4, bands: ['edge'], weight: 1, build: () => [
      { geo: g.box, mat: k.mats.wood, m: M(0, 0.5, 0, 0, 0, 0, 2.2, 0.1, 0.6) },
      { geo: g.box, mat: k.mats.wood, m: M(0, 0.9, -0.28, 0, 0, 0, 2.2, 0.6, 0.08) },
      { geo: g.box, mat: iron, m: M(-0.9, 0.25, 0, 0, 0, 0, 0.1, 0.5, 0.6) },
      { geo: g.box, mat: iron, m: M(0.9, 0.25, 0, 0, 0, 0, 0.1, 0.5, 0.6) },
    ] },
    { name: 'coalHeap', radius: 2, bands: ['edge', 'mid'], weight: 1.5, build: (r) => Array.from({ length: 5 }, () => ({ geo: g.sphere, mat: coal, m: M(r.range(-1, 1), 0.3, r.range(-1, 1), 0, r.range(0, 6), 0, r.range(0.6, 1.2), r.range(0.3, 0.6), r.range(0.6, 1.2)) })) },
    { name: 'wagon', radius: 4, bands: ['mid'], weight: 1, build: (r) => [
      { geo: g.box, mat: r.next() > 0.5 ? k.mats.rust : soot, m: M(0, 2, 0, 0, 0, 0, 2.8, 2.6, 8) },
      { geo: g.box, mat: iron, m: M(0, 0.55, 0, 0, 0, 0, 2.4, 0.5, 8.4) },
      ...[-2.8, 2.8].flatMap((z) => [-1.1, 1.1].map((x) => ({ geo: g.cylLow, mat: iron, m: M(x, 0.45, z, 0, 0, Math.PI / 2, 0.45, 0.2, 0.45) }))),
    ] },
    { name: 'warehouse', radius: 6, height: 12, bands: ['mid', 'far'], weight: 1.2, build: (r) => {
      const h = r.range(7, 11);
      return [
        { geo: g.box, mat: brick, m: M(0, h / 2, 0, 0, 0, 0, 11, h, 8) },
        { geo: g.box, mat: slate, m: M(0, h + 0.2, 0, 0, 0, 0, 11.6, 0.4, 8.6) },
        { geo: g.box, mat: gas, m: M(-2.5, h * 0.6, 4.02, 0, 0, 0, 1.2, 1.6, 0.05), shadow: false },
        { geo: g.box, mat: k.mats.dark, m: M(2, 1.8, 4.02, 0, 0, 0, 3.2, 3.6, 0.05) },
      ];
    } },
    { name: 'smokestack', radius: 3, height: 35, bands: ['far'], weight: 2.5, emitter: (r) => ({ local: new Vector3(0, 34, 0), opts: { kind: 'smoke', rate: 4 + r.next() * 2, velocity: { x: 0, y: 2.4, z: 0 }, spread: 1, life: [5, 9], size: [4, 13] } }), build: () => [
      { geo: g.cyl, mat: brick, m: M(0, 17, 0, 0, 0, 0, 1.6, 34, 1.6) },
      { geo: g.cyl, mat: soot, m: M(0, 33, 0, 0, 0, 0, 1.9, 1.6, 1.9) },
      { geo: g.box, mat: brick, m: M(0, 2, 0, 0, 0, 0, 5, 4, 5) },
    ] },
    { name: 'gasometer', radius: 9, height: 20, bands: ['far'], weight: 1.2, build: (r) => {
      const h = r.range(10, 16);
      const parts: Part[] = [
        { geo: g.cyl, mat: gasHolder, m: M(0, h / 2, 0, 0, 0, 0, 8, h, 8) },
        { geo: g.sphere, mat: slate, m: M(0, h, 0, 0, 0, 0, 8, 1.2, 8) },
      ];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        parts.push({ geo: g.box, mat: iron, m: M(Math.cos(a) * 8.6, (h + 4) / 2, Math.sin(a) * 8.6, 0, 0, 0, 0.4, h + 4, 0.4) });
      }
      for (const y of [h * 0.4, h + 3.6]) parts.push({ geo: g.cyl, mat: iron, m: M(0, y, 0, 0, 0, 0, 8.7, 0.3, 8.7) });
      return parts;
    } },
  ];
}

function decorate(ctx: WorldContext): void {
  const { scene, track, tex, rng, emitters, localLights, heightAt } = ctx;
  const HW = track.halfWidth;
  const batch = new Batch();
  const box = new BoxGeometry(1, 1, 1);
  const cyl = new CylinderGeometry(1, 1, 1, 10);
  const prism = new CylinderGeometry(1, 1, 1, 3);
  prism.rotateZ(Math.PI / 2);
  prism.rotateY(Math.PI / 2);
  const brickMats = ['#C8907A', '#B88068', '#A87866', '#C09A84'].map((c) => ctx.ink({ map: tex.brick, mapping: 'world', mapScale: 0.25, color: c }));
  const slate = ctx.ink({ map: tex.flagstone, mapping: 'world', mapScale: 0.5, color: '#6A7078' });
  const stone = ctx.ink({ map: tex.flagstone, mapping: 'world', mapScale: 0.3, color: '#B0A898' });
  const iron = ctx.ink({ color: '#2E2A28', sheen: 0.5 });
  const verdigris = ctx.ink({ color: P.verdigris, sheen: 0.3 });
  const gas = ctx.ink({ color: '#000000', emissive: P.gaslight, emissiveIntensity: 3, emissivePreset: 'fire', hatch: false, lineWeight: 0.2 });
  // Windows: a grid of warm panes, some dark, as an emissive map on the facade.
  const windows = paint(256, 256, (c) => {
    c.fillStyle = '#000';
    c.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 4; x++) {
        if (rng.next() < 0.35) continue;
        c.fillStyle = rng.next() < 0.3 ? '#FFB050' : '#FFD890';
        c.fillRect(20 + x * 60, 26 + y * 80, 30, 46);
      }
  });
  const windowMat = ctx.ink({ color: '#000000', emissiveMap: windows, emissive: P.gaslight, emissiveIntensity: 2.4, emissivePreset: 'steady', hatch: false, lineWeight: 0.2 });
  const pools: { x: number; y: number; z: number; r: number }[] = [];

  // Terraces: brick houses facing the road behind the railings, roofs, chimneys with smoke.
  const station = zoneRanges(ctx, 'station');
  const yard = zoneRanges(ctx, 'yard');
  // On the camera side of the road they are cut down to what does not hide the street.
  alongTrack(ctx, { step: 12, off: HW + 10, extra: 1, radius: 5.5, where: (t) => !inZones(yard, t) }, (p, yaw) => {
    const lim = heightLimit(ctx, p.x, p.z, 3.5) - 3;
    if (lim < 3.2) return;
    const h = Math.min(7 + Math.floor(rng.next() * 3) * 2.6, lim);
    const w = W(p.x, p.y, p.z, yaw);
    batch.part(w, box, rng.pick(brickMats), T(0, h / 2, 0, 0, 0, 0, 10.5, h, 7));
    batch.part(w, prism, slate, T(0, h + 1.4, 0, 0, 0, 0, 3.6, 10.8, 4.4));
    batch.part(w, box, windowMat, T(0, h * 0.55, 3.52, 0, 0, 0, 9, h * 0.8, 0.04), false);
    batch.part(w, box, stone, T(0, 0.5, 3.6, 0, 0, 0, 10.6, 1, 0.3));
    if (h + 6 < lim + 3 && rng.next() < 0.6) {
      const cx = rng.range(-3.5, 3.5);
      batch.part(w, box, brickMats[0]!, T(cx, h + 3, -1, 0, 0, 0, 1.2, 3, 1.2));
      if (rng.next() < 0.35) {
        const c = new Vector3(cx, h + 4.6, -1).applyMatrix4(w);
        emitters.push({ kind: 'smoke', rate: 1.6, position: { x: c.x, y: c.y, z: c.z }, velocity: { x: 0, y: 1.6, z: 0 }, spread: 0.4, life: [3, 5], size: [1, 4] });
      }
    }
  });

  // Gas lamps at a regular spacing along both kerbs, with light pools (a few real lights).
  let lights = 0;
  alongTrack(ctx, { step: 18, off: HW + 1.8, radius: 0.8 }, (p, yaw, t, side) => {
    const w = W(p.x, p.y, p.z, yaw);
    batch.part(w, cyl, iron, T(0, 2.4, 0, 0, 0, 0, 0.12, 4.8, 0.12));
    batch.part(w, cyl, iron, T(0, 0.3, 0, 0, 0, 0, 0.25, 0.6, 0.25));
    batch.part(w, box, iron, T(0, 4.9, 0.5, 0, 0, 0, 0.08, 0.08, 1.1));
    batch.part(w, box, gas, T(0, 4.7, 1.0, 0, 0, 0, 0.45, 0.6, 0.45), false);
    const lp = new Vector3(0, 0, 1).applyMatrix4(w);
    pools.push({ x: lp.x, y: p.y, z: lp.z, r: 6 });
    if (lights < 5 && Math.round(t * 40) % 6 === (side > 0 ? 0 : 3)) {
      const l = new PointLight('#FFB860', tunables.get('light.furnaceIntensity'), tunables.get('light.furnaceRange'), 2);
      l.position.set(lp.x, p.y + 4.5, lp.z);
      scene.add(l);
      localLights.push(l);
      lights++;
    }
  });

  // Bunting strung across the road, red / cream / green pennants (non-colliding, 7 m up).
  const flags = ['#A02A22', '#E8DCC0', '#5E8A7A'].map((c) => ctx.ink({ color: c, lineWeight: 0.3 }));
  const pennant = new CylinderGeometry(0.45, 0, 0.9, 3);
  for (let i = 0; i < 9; i++) {
    const t = (i + 0.5) / 9;
    const a = besideExact(ctx, t, HW + 2);
    const b = besideExact(ctx, t, -(HW + 2));
    if (ctx.distToTrack((a.x + b.x) / 2, (a.z + b.z) / 2) > 2) continue;
    const y0 = Math.max(a.y, b.y) + 7;
    const n = 14;
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      const x = a.x + (b.x - a.x) * u;
      const z = a.z + (b.z - a.z) * u;
      const sag = Math.sin(u * Math.PI) * 1.2;
      batch.add(pennant, flags[k % 3]!, T(x, y0 - sag - 0.5, z, 0, Math.atan2(b.x - a.x, b.z - a.z), 0), false);
    }
  }

  // Canal under the humped bridge: dark water across the road, stone embankments.
  const water = ctx.ink({ color: '#2E3A3E', sheen: 1, lineWeight: 0.3 });
  const barge = ctx.ink({ map: tex.planks, mapping: 'world', mapScale: 0.5, color: '#8A6A4A' });
  for (const [a, b] of zoneRanges(ctx, 'canal')) {
    const t = (a + b) / 2;
    const c = besideExact(ctx, t, 0);
    const tan = ctx.curve.getTangentAt(t);
    const yaw = Math.atan2(tan.x, tan.z);
    for (const side of [-1, 1]) {
      const off = side * (HW + 26);
      const p = besideExact(ctx, t, off);
      const w = W(p.x, heightAt(c.x, c.z) - 1.5, p.z, yaw);
      batch.part(w, box, water, T(0, 0, 0, 0, 0, 0, 52, 0.2, 14), false);
      batch.part(w, box, stone, T(0, 0.6, 7.6, 0, 0, 0, 52, 2.6, 1.2));
      batch.part(w, box, stone, T(0, 0.6, -7.6, 0, 0, 0, 52, 2.6, 1.2));
      ctx.reserved.push({ x: p.x, z: p.z, r: 20 });
      // A moored barge.
      batch.part(w, box, barge, T(side * 10, 0.6, 2, 0, 0, 0, 10, 1.2, 3.6));
    }
  }

  // Parked freight wagons and signal posts along the railway yard.
  const red = ctx.ink({ color: '#000000', emissive: '#FF3020', emissiveIntensity: 3, emissivePreset: 'steady', hatch: false });
  alongTrack(ctx, { step: 26, off: HW + 7, extra: 2, radius: 4, where: (t) => inZones(yard, t) }, (p, yaw) => {
    const w = W(p.x, p.y, p.z, yaw + Math.PI / 2);
    batch.part(w, box, rng.pick(brickMats), T(0, 2, 0, 0, 0, 0, 2.8, 2.6, 8));
    batch.part(w, box, iron, T(0, 0.55, 0, 0, 0, 0, 2.4, 0.5, 8.4));
    const s = W(p.x, p.y, p.z, yaw);
    batch.part(s, box, iron, T(5, 3, 0, 0, 0, 0, 0.25, 6, 0.25));
    batch.part(s, box, red, T(5, 5.6, 0.2, 0, 0, 0, 0.4, 0.4, 0.1), false);
  });

  // Crowd: stands along the avenue and in front of the station, banners with the crest.
  const crowdMats = ['#3A3A4A', '#5A3A2E', '#2E3A34', '#6A5A4A', '#4A2E2E'].map((c) => ctx.ink({ color: c, lineWeight: 0.5 }));
  const head = ctx.ink({ color: '#D0A888' });
  const crest = ctx.ink({ map: crestTexture('#5E8A7A', '#F0E2C8'), mapping: 'uv' });
  const crest2 = ctx.ink({ map: crestTexture('#7A2A22', '#F0D890'), mapping: 'uv' });
  const avenue = zoneRanges(ctx, 'avenue');
  alongTrack(ctx, { step: 26, off: HW + 4.5, side: 1, extra: 1, radius: 4, where: (t) => inZones([...avenue, ...station], t) }, (p, yaw) => {
    const w = W(p.x, p.y, p.z, yaw);
    for (let row = 0; row < 3; row++) batch.part(w, box, stone, T(0, 0.4 + row * 0.7, -row * 1.2, 0, 0, 0, 12, 0.8, 1.2));
    for (let row = 0; row < 3; row++) crowd(batch, w, 10, 11, 0.4, 0.8 + row * 0.7, crowdMats, head, rng, 0.95);
    batch.part(w, box, iron, T(-6.4, 3, -2.4, 0, 0, 0, 0.2, 6, 0.2));
    batch.part(w, box, iron, T(6.4, 3, -2.4, 0, 0, 0, 0.2, 6, 0.2));
    batch.part(w, box, rng.next() > 0.5 ? crest : crest2, T(0, 5, -2.4, 0, 0, 0, 3.4, 4.6, 0.1));
  });

  // Steam leaking from manholes on the road.
  for (let i = 0; i < 6; i++) {
    const p = besideExact(ctx, (i + 0.2) / 6, rng.range(-HW * 0.6, HW * 0.6));
    emitters.push({ kind: 'steam', rate: 2, position: { x: p.x, y: p.y + 0.2, z: p.z }, velocity: { x: 0, y: 1.6, z: 0 }, spread: 0.6, life: [1.5, 3], size: [1, 3.5] });
  }

  // Skyline: tall smokestacks and terraces on a ring, airships drifting overhead.
  for (const q of ringAround(ctx, 50, 22)) {
    if (!isFree(ctx, q.x, q.z, 10)) continue;
    const y = heightAt(q.x, q.z);
    const w = W(q.x, y, q.z, -q.a + Math.PI / 2);
    const h = 14 + rng.next() * 10;
    batch.part(w, box, rng.pick(brickMats), T(0, h / 2, 0, 0, 0, 0, 30, h, 12));
    batch.part(w, box, windowMat, T(0, h * 0.5, -6.05, 0, 0, 0, 26, h * 0.7, 0.05), false);
    if (rng.next() < 0.5) {
      batch.part(w, cyl, brickMats[1]!, T(8, h + 12, 0, 0, 0, 0, 1.5, 24, 1.5));
      const c = new Vector3(8, h + 24, 0).applyMatrix4(w);
      emitters.push({ kind: 'smoke', rate: 3, position: { x: c.x, y: c.y, z: c.z }, velocity: { x: 0, y: 2.2, z: 0 }, spread: 1, life: [5, 9], size: [4, 12] });
    }
  }
  const b = track.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const airships: { g: Group; r: number; a: number; s: number; y: number }[] = [];
  const envelope = ctx.ink({ color: '#B8A890', lineWeight: 0.6 });
  for (let i = 0; i < 3; i++) {
    const g = new Group();
    const body = new Mesh(new SphereGeometry(1, 16, 10), envelope);
    body.scale.set(5, 4.5, 16);
    g.add(body);
    const gondola = new Mesh(new BoxGeometry(2.4, 1.6, 6), iron);
    gondola.position.y = -5.4;
    g.add(gondola);
    for (const s of [-1, 1]) {
      const fin = new Mesh(new BoxGeometry(0.2, 4, 3), verdigris);
      fin.position.set(s * 3, 0, -14);
      fin.rotation.z = s * 0.5;
      g.add(fin);
    }
    scene.add(g);
    // Below the camera (about 67 m up) so they read; wide circles so they mostly cross the edges of the view.
    airships.push({ g, r: Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 30 + i * 40, a: i * 2.1, s: 0.03 + i * 0.01, y: 36 + i * 6 });
    g.traverse((o) => ((o as Mesh).isMesh ? ((o as Mesh).castShadow = true) : null));
  }
  ctx.animate((dt) => {
    for (const s of airships) {
      s.a += s.s * dt;
      s.g.position.set(cx + Math.cos(s.a) * s.r, s.y, cz + Math.sin(s.a) * s.r);
      s.g.rotation.y = -s.a;
    }
  });

  glowPools(scene, pools, P.gaslight, 0.2);
  batch.flush(scene);
}

/** The Grand Station (landmark): brick hall, verdigris dome, amber clock rose window, crest banners. */
function grandStation(ctx: WorldContext, x: number, z: number, facing: number, r: number): void {
  const { tex, scene, localLights } = ctx;
  const g = new Group();
  const brick = ctx.ink({ map: tex.brick, mapping: 'world', mapScale: 0.2, color: '#C8907A' });
  const stone = ctx.ink({ map: tex.flagstone, mapping: 'world', mapScale: 0.25, color: '#C8C0B0' });
  const dome = ctx.ink({ color: P.verdigris, sheen: 0.4 });
  const iron = ctx.ink({ color: '#2E2A28', sheen: 0.5 });
  const clock = paint(512, 512, (c) => {
    c.fillStyle = '#000';
    c.fillRect(0, 0, 512, 512);
    c.translate(256, 256);
    c.fillStyle = '#FFD890';
    c.beginPath();
    c.arc(0, 0, 240, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#2A1A10';
    c.lineWidth = 14;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      c.beginPath();
      c.moveTo(Math.cos(a) * 60, Math.sin(a) * 60);
      c.lineTo(Math.cos(a) * 240, Math.sin(a) * 240);
      c.stroke();
    }
    for (const rr of [60, 150, 240]) {
      c.beginPath();
      c.arc(0, 0, rr, 0, Math.PI * 2);
      c.stroke();
    }
    c.lineWidth = 18;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(0, -130);
    c.moveTo(0, 0);
    c.lineTo(90, 40);
    c.stroke();
  });
  const rose = ctx.ink({ color: '#000000', emissiveMap: clock, emissive: P.gaslight, emissiveIntensity: 3.2, emissivePreset: 'steady', hatch: false });
  const crest = ctx.ink({ map: crestTexture('#7A2A22', '#F0D890'), mapping: 'uv' });
  const add = (geo: BufferGeometry, mat: InkLitMaterial, px: number, py: number, pz: number, sx = 1, sy = 1, sz = 1) => {
    const m = new Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.scale.set(sx, sy, sz);
    g.add(m);
    return m;
  };
  const box = new BoxGeometry(1, 1, 1);
  const W2 = Math.min(r * 2, 40);
  // Main hall and two wings; the facade (+Z) faces the finish straight.
  add(box, brick, 0, 7, -4, W2, 14, 18);
  for (const s of [-1, 1]) {
    add(box, brick, s * (W2 / 2 + 5), 5, -2, 10, 10, 14);
    add(new CylinderGeometry(1, 1, 1, 4), dome, s * (W2 / 2 + 5), 11.5, -2, 7, 3, 9);
    add(box, crest, s * (W2 / 2 + 5), 6, 5.1, 4, 6, 0.1);
  }
  // Facade: stone columns and cornice.
  for (let i = -3; i <= 3; i++) add(new CylinderGeometry(0.6, 0.7, 11, 10), stone, i * (W2 / 7), 5.5, 5.4);
  add(box, stone, 0, 11.6, 5.4, W2 + 1, 1.2, 2);
  add(box, stone, 0, 0.4, 5.6, W2 + 1, 0.8, 3);
  // Dome on a drum, lantern on top.
  add(new CylinderGeometry(9, 9, 4, 24), stone, 0, 16, -4);
  const d = add(new SphereGeometry(9, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), dome, 0, 18, -4);
  d.scale.set(1, 1.15, 1);
  add(new CylinderGeometry(1.4, 1.6, 4, 10), stone, 0, 30, -4);
  add(new SphereGeometry(1.6, 10, 6), dome, 0, 32.6, -4);
  // Clock rose window above the entrance, framed in stone.
  add(new TorusGeometry(5.4, 0.6, 8, 32), stone, 0, 17, 5.2);
  add(new PlaneGeometry(10.4, 10.4), rose, 0, 17, 5.3);
  add(box, stone, 0, 17, 4.8, 13, 13, 1.2);
  add(box, iron, 0, 3, 5.7, 6, 6, 0.2);
  const light = new PointLight('#FFC46A', tunables.get('light.furnaceIntensity') * 2, 40, 2);
  light.position.set(0, 12, 14);
  g.add(light);
  localLights.push(light);
  ctx.place(g, x, z, facing);
  ctx.emitters.push({ kind: 'steam', rate: 3, position: { x, y: ctx.heightAt(x, z) + 1, z }, velocity: { x: 0, y: 1.5, z: 0 }, spread: 4, life: [3, 5], size: [3, 8] });
  void scene;
}
