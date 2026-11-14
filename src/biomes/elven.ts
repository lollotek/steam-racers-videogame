/**
 * Elven village — *Lirael Canopy* (doc 04 §7.4). A city grown, not built: giant trees with
 * glowing cyan canopies, towers of living wood and silver, rune banners flowing cyan and green,
 * statues of archers and mages, glowing mushrooms and crystal lamps, tree-lungs breathing steam,
 * rain and mist, mountains far away. Flowing, vertical, curved: no right angles. The Mother Tree
 * with the mage carved in its trunk stands inside the long climbing curve.
 */
import {
  CylinderGeometry,
  DoubleSide,
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
import { lightPool } from '../world/kit';
import { Batch, T, W, alongTrack, heightLimit, besideExact, crowd, glowPools, inZones, isFree, paint, ringAround, zoneRanges } from './common';

const P = {
  ink: '#0E1614',
  bark: '#3A3A36',
  silver: '#8A9290',
  moss: '#3E5A3E',
  leaf: '#1F7A6A',
  cyan: '#3FF0E0',
  green: '#5AFF8A',
  window: '#FFB86A',
  fog: '#4A5A60',
};

/** Flowing rune glyphs on a vertical banner (emissive mask). */
function runeBanner(seed: number) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return paint(128, 512, (c) => {
    c.fillStyle = '#000';
    c.fillRect(0, 0, 128, 512);
    c.strokeStyle = '#fff';
    c.lineWidth = 6;
    c.lineCap = 'round';
    c.shadowColor = '#fff';
    c.shadowBlur = 8;
    for (let y = 40; y < 480; y += 64) {
      c.beginPath();
      c.moveTo(64, y);
      c.bezierCurveTo(64 + (rnd() - 0.5) * 80, y + 10, 64 + (rnd() - 0.5) * 80, y + 30, 64, y + 44);
      c.stroke();
      c.beginPath();
      c.arc(64 + (rnd() - 0.5) * 40, y + 22, 8 + rnd() * 8, 0, Math.PI * (1 + rnd()));
      c.stroke();
    }
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(14, 0);
    c.lineTo(14, 512);
    c.moveTo(114, 0);
    c.lineTo(114, 512);
    c.stroke();
  });
}

export const ELVEN: BiomeDef = {
  id: 'elven',
  name: 'Lirael Canopy',
  tunables: {
    'fog.color': P.fog,
    'fog.density': 0.012,
    'fog.start': 40,
    'fog.heightFalloff': 0.07,
    'light.keyColor': '#A8BCC4',
    'light.keyIntensity': 3.0,
    'light.keyPitch': 62,
    'light.keyYaw': 190,
    'light.skyColor': '#7A8C94',
    'light.groundColor': '#24302C',
    'light.ambient': 2.9,
    'light.furnaceIntensity': 520,
    'light.furnaceRange': 22,
    'ink.color': P.ink,
    'ink.shadowColor': '#1E2A2A',
    'ink.litTint': '#E8FFF8',
    'post.lift': '#08100E',
    'post.gain': '#E8F8F4',
    'post.saturation': 0.92,
    'post.bloomStrength': 1.0,
    'post.bloomThreshold': 0.9,
    'fx.wind': 0.9,
  },
  ground: { tex: 'dirt', tint: '#6E8A66', scale: 1 / 10 },
  surfaces: {
    heartwood: { tex: 'planks', scale: 1, tint: '#B0A494' },
    moss: { tex: 'dirt', scale: 2, tint: '#7A9A6A' },
    water: { tex: 'dirt', scale: 2, tint: '#5E7E84', sheen: 1 },
    flagstone: { tex: 'flagstone', scale: 1, tint: '#A4AEA8' },
  },
  skirt: { tex: 'bark', tint: '#8A847A', scale: 0.2 },
  gantry: { lines: ['LIRAEL'], bg: '#2E4A44', fg: '#C8FFF4' },
  clearView: true,
  pit: 'dark',
  rain: { color: '#B8D0D8', count: 1300, speed: 26 },
  debris: { color: '#3E5A3E', scale: 0.5 },
  theme: { density: 1, other: 0, own: 1, mul: { rocks: 0.4 } },
  themes: {
    roots: { density: 1, other: 0, own: 1, mul: { rocks: 0.3, mushrooms: 2, fern: 2 } },
    crystal: { density: 0.9, other: 0, own: 1, mul: { crystalLamp: 3, runeStone: 2, mushrooms: 1 } },
    earth: { density: 0.7, other: 0, own: 1, mul: { rocks: 1, fern: 3, mushrooms: 1.5 } },
  },
  props,
  decorate,
  landmark(ctx, lm) {
    if (lm.id !== 'mother-tree') return false;
    motherTree(ctx, lm.x, lm.z, lm.facing, lm.r);
    return true;
  },
};

function props(k: PropKit): PropDef[] {
  const { M, g, ink, tex } = k;
  const bark = ink({ map: tex.bark, mapping: 'world', mapScale: 0.25, color: '#9A9488' });
  const silver = ink({ color: P.silver, sheen: 0.8 });
  const stem = ink({ color: '#D8D0C0' });
  const cap = ink({ color: '#1E4A4A', emissive: P.cyan, emissiveIntensity: 1.8, emissivePreset: 'rune', phase: 1.3 });
  const capG = ink({ color: '#1E4A2E', emissive: P.green, emissiveIntensity: 1.6, emissivePreset: 'rune', phase: 3.1 });
  const crystal = ink({ color: '#5AA8A0', emissive: P.cyan, emissiveIntensity: 2.5, emissivePreset: 'rune', sheen: 1 });
  const fern = ink({ color: '#3E6A44' });
  const leaf = ink({ color: '#1A4A44', emissive: P.leaf, emissiveIntensity: 0.9, emissivePreset: 'rune', phase: 2 });
  const stone = ink({ map: tex.flagstone, mapping: 'world', mapScale: 0.3, color: '#7A8A84' });
  const rune = ink({ color: '#000000', emissive: P.green, emissiveIntensity: 3, emissivePreset: 'rune', hatch: false, phase: 0.7 });
  const shard = new CylinderGeometry(0, 1, 1, 5);
  const trunk = new CylinderGeometry(0.7, 1, 1, 10);
  return [
    { name: 'mushrooms', radius: 1.4, bands: ['edge', 'mid'], weight: 3, build: (r) => Array.from({ length: r.int(2, 5) }, () => {
      const x = r.range(-1, 1);
      const z = r.range(-1, 1);
      const s = r.range(0.5, 1.4);
      return [
        { geo: g.cylLow, mat: stem, m: M(x, s * 0.5, z, 0, 0, 0, 0.12 * s, s, 0.12 * s) },
        { geo: g.sphere, mat: r.next() > 0.4 ? cap : capG, m: M(x, s, z, 0, 0, 0, 0.55 * s, 0.25 * s, 0.55 * s), shadow: false },
      ];
    }).flat() },
    { name: 'fern', radius: 1.2, bands: ['edge', 'mid'], weight: 2, build: (r) => Array.from({ length: 6 }, (_, i) => ({ geo: g.cone, mat: fern, m: M(0, 0.6, 0, 0.9, (i / 6) * Math.PI * 2 + r.range(0, 0.4), 0, 0.25, 1.6, 0.06) })) },
    { name: 'crystalLamp', radius: 1.2, bands: ['edge'], weight: 2, build: (r) => [
      { geo: g.cylLow, mat: silver, m: M(0, 1.1, 0, 0, 0, 0, 0.1, 2.2, 0.1) },
      { geo: shard, mat: crystal, m: M(0, 2.6, 0, 0, r.range(0, 3), 0, 0.35, 1.1, 0.35), shadow: false },
      { geo: shard, mat: crystal, m: M(0, 1.9, 0, Math.PI, 0, 0, 0.35, 0.6, 0.35), shadow: false },
    ] },
    { name: 'runeStone', radius: 1.4, bands: ['edge', 'mid'], weight: 1.5, build: (r) => [
      { geo: g.sphere, mat: stone, m: M(0, 1.2, 0, 0, r.range(0, 6), r.range(-0.15, 0.15), 0.8, 1.6, 0.5) },
      { geo: g.box, mat: rune, m: M(0, 1.3, 0.48, 0, 0, 0, 0.12, 1.4, 0.04), shadow: false },
    ] },
    { name: 'youngTree', radius: 3, height: 15, bands: ['mid'], weight: 3, build: (r) => {
      const h = r.range(7, 12);
      return [
        { geo: trunk, mat: bark, m: M(0, h / 2, 0, r.range(-0.08, 0.08), 0, r.range(-0.08, 0.08), 0.7, h, 0.7) },
        { geo: g.sphere, mat: leaf, m: M(0, h, 0, 0, 0, 0, r.range(3, 4.5), r.range(1.6, 2.4), r.range(3, 4.5)) },
        { geo: g.sphere, mat: leaf, m: M(r.range(-1.5, 1.5), h - 1.6, r.range(-1.5, 1.5), 0, 0, 0, 2.4, 1.2, 2.4) },
      ];
    } },
    { name: 'bigTree', radius: 7, height: 52, bands: ['far'], weight: 3, build: (r) => {
      const h = r.range(30, 48);
      const parts: Part[] = [
        { geo: trunk, mat: bark, m: M(0, h / 2, 0, 0, 0, 0, 2.6, h, 2.6) },
        { geo: g.sphere, mat: leaf, m: M(0, h, 0, 0, 0, 0, 10, 4.5, 10) },
        { geo: g.sphere, mat: leaf, m: M(3, h - 7, -2, 0, 0, 0, 7, 3, 7) },
      ];
      for (let i = 0; i < 4; i++) parts.push({ geo: g.cylLow, mat: bark, m: M(Math.cos(i * 1.6) * 3, 0.8, Math.sin(i * 1.6) * 3, Math.sin(i * 1.6) * 0.8, 0, -Math.cos(i * 1.6) * 0.8, 0.7, 5, 0.7) });
      return parts;
    } },
  ];
}

function decorate(ctx: WorldContext): void {
  const { scene, track, tex, rng, emitters, localLights, heightAt } = ctx;
  const HW = track.halfWidth;
  const batch = new Batch();
  const cyl = new CylinderGeometry(1, 1, 1, 12);
  const taper = new CylinderGeometry(0.55, 1, 1, 12);
  const sphere = new SphereGeometry(1, 14, 10);
  const cone = new CylinderGeometry(0, 1, 1, 10);
  const bark = ctx.ink({ map: tex.bark, mapping: 'world', mapScale: 0.15, color: '#9A9488' });
  const silver = ctx.ink({ map: tex.planks, mapping: 'world', mapScale: 0.3, color: '#C8D0CC', sheen: 0.8 });
  const leaf = ctx.ink({ color: '#24564E', emissive: P.leaf, emissiveIntensity: 0.55, emissivePreset: 'rune', phase: 0.5 });
  const leafB = ctx.ink({ color: '#244656', emissive: '#2A8AB0', emissiveIntensity: 0.5, emissivePreset: 'rune', phase: 2.5 });
  const windowMat = ctx.ink({ color: '#000000', emissive: P.window, emissiveIntensity: 2.6, emissivePreset: 'fire', hatch: false, lineWeight: 0.2 });
  const marble = ctx.ink({ color: '#C8CCC8' });
  const snow = ctx.ink({ color: '#E8F0F0' });
  const mountain = ctx.ink({ color: '#5A6A70' });
  const cyanPools: { x: number; y: number; z: number; r: number }[] = [];
  const orbMat = ctx.ink({ color: '#000000', emissive: P.cyan, emissiveIntensity: 4, emissivePreset: 'rune', hatch: false });
  const bow = new TorusGeometry(1.6, 0.08, 4, 16, Math.PI);
  const ring = new TorusGeometry(4.2, 0.35, 6, 24);

  // Giant trees beside the road: tall trunks with root flares and glowing canopies, a lit window
  // or two, tree-lungs breathing steam from the bark.
  // On the camera side they are young trees below the sight line; canopies never overhang the road.
  alongTrack(ctx, { step: 38, off: HW + 16, extra: 2, radius: 7 }, (p, yaw) => {
    const room = ctx.distToTrack(p.x, p.z) - HW - 2.5;
    const lim = heightLimit(ctx, p.x, p.z, room);
    const big = lim > 34;
    const h = big ? 24 + rng.next() * 10 : Math.max(6, Math.min(12, lim - 2));
    const r = big ? 2.2 + rng.next() * 1.2 : 0.8;
    const cr = Math.min(big ? 9 + r : 4, room);
    const w = W(p.x, p.y, p.z, yaw);
    batch.part(w, taper, bark, T(0, h / 2, 0, 0, 0, 0, r, h, r));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rng.next();
      batch.part(w, cyl, bark, T(Math.cos(a) * r * 1.3, 0.6, Math.sin(a) * r * 1.3, Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1, r * 0.35, r * 2.2, r * 0.35));
    }
    batch.part(w, sphere, rng.next() > 0.4 ? leaf : leafB, T(0, h, 0, 0, rng.next() * 3, 0, cr, cr * 0.36, cr), false);
    if (big) batch.part(w, sphere, leaf, T(rng.range(-3, 3), h - 6, -3, 0, 0, 0, cr * 0.6, 2.4, cr * 0.6), false);
    batch.part(w, cyl, windowMat, T(0, h * 0.35, r * 0.82, 0, 0, 0, 0.5, 1.1, 0.05), false);
    if (rng.next() < 0.5) {
      const c = new Vector3(r * 0.9, h * 0.55, 0).applyMatrix4(w);
      emitters.push({ kind: 'steam', rate: 2.5, position: { x: c.x, y: c.y, z: c.z }, velocity: { x: 0, y: 1.8, z: 0 }, spread: 0.6, life: [2.5, 4], size: [1.5, 5] });
    }
  });

  // Organic towers of silverwood: tapered spires with bulb tops and warm windows.
  alongTrack(ctx, { step: 120, off: HW + 30, extra: 10, radius: 6 }, (p, yaw) => {
    const h = 26 + rng.next() * 14;
    if (heightLimit(ctx, p.x, p.z, 4) < h + 12) return;
    const w = W(p.x, p.y, p.z, yaw);
    batch.part(w, taper, silver, T(0, h / 2, 0, 0, 0, 0, 2.6, h, 2.6));
    batch.part(w, sphere, silver, T(0, h + 2, 0, 0, 0, 0, 4, 5, 4));
    batch.part(w, cone, silver, T(0, h + 9, 0, 0, 0, 0, 1.2, 8, 1.2));
    for (let i = 0; i < 4; i++) batch.part(w, cyl, windowMat, T(0, h * (0.3 + i * 0.15), 2.3 - i * 0.2, 0, 0, 0, 0.5, 1.2, 0.05), false);
    batch.part(w, ring, silver, T(0, h * 0.62, 0, Math.PI / 2, 0, 0));
  });

  // Rune banners: tall vertical cloths with flowing cyan and green glyphs, swaying.
  const bannerCyan = ctx.ink({ color: '#14302E', emissiveMap: runeBanner(7), emissive: P.cyan, emissiveIntensity: 3, emissivePreset: 'rune', lineWeight: 0.3 });
  const bannerGreen = ctx.ink({ color: '#14301E', emissiveMap: runeBanner(19), emissive: P.green, emissiveIntensity: 3, emissivePreset: 'rune', lineWeight: 0.3, phase: 2 });
  bannerCyan.side = DoubleSide;
  bannerGreen.side = DoubleSide;
  const banners: Mesh[] = [];
  const avenue = zoneRanges(ctx, 'avenue');
  alongTrack(ctx, { step: 22, off: HW + 4, radius: 1.5, where: (t) => inZones(avenue, t) || rng.next() < 0.25 }, (p, yaw) => {
    const w = W(p.x, p.y, p.z, yaw);
    batch.part(w, cyl, silver, T(0, 5, 0, 0, 0, 0, 0.14, 10, 0.14));
    batch.part(w, sphere, silver, T(0, 10.2, 0, 0, 0, 0, 0.3));
    const m = new Mesh(new PlaneGeometry(2, 7), rng.next() > 0.5 ? bannerCyan : bannerGreen);
    m.position.set(0.15, 6, 0.3).applyMatrix4(w);
    m.rotation.y = yaw;
    scene.add(m);
    banners.push(m);
  });
  ctx.animate((_dt, time) => banners.forEach((b, i) => (b.rotation.z = Math.sin(time * 1.3 + i) * 0.04)));

  // Statues of archers and mages on plinths along the avenue and the path.
  const path = zoneRanges(ctx, 'path');
  alongTrack(ctx, { step: 40, off: HW + 7, extra: 2, radius: 3, where: (t) => inZones([...avenue, ...path], t) }, (p, yaw) => {
    const w = W(p.x, p.y, p.z, yaw);
    const mage = rng.next() > 0.5;
    batch.part(w, cyl, marble, T(0, 0.8, 0, 0, 0, 0, 1.6, 1.6, 1.6));
    batch.part(w, cone, marble, T(0, 4.2, 0, 0, 0, 0, 1.3, 5.2, 1.3));
    batch.part(w, sphere, marble, T(0, 7.2, 0, 0, 0, 0, 0.55));
    if (mage) {
      batch.part(w, cyl, marble, T(1, 5.5, 0.3, 0, 0, -0.1, 0.1, 6, 0.1));
      batch.part(w, sphere, orbMat, T(1.3, 8.6, 0.3, 0, 0, 0, 0.45), false);
    } else {
      batch.part(w, bow, marble, T(0.9, 5.6, 0.6, 0, Math.PI / 2, 0));
    }
  });

  // Walkway bridges between neighbouring trunks high above the road side (curved silver planks).
  for (let i = 0; i < 7; i++) {
    const t = (i + 0.5) / 7;
    const side = i % 2 ? 1 : -1;
    const a = besideExact(ctx, t, side * (HW + 24));
    const b = besideExact(ctx, t + 0.03, side * (HW + 24));
    if (ctx.distToTrack((a.x + b.x) / 2, (a.z + b.z) / 2) < HW + 10 || heightLimit(ctx, (a.x + b.x) / 2, (a.z + b.z) / 2, 2) < 20) continue;
    const y = Math.max(a.y, b.y) + 14;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    batch.add(new TorusGeometry(len / 2, 0.4, 6, 20, Math.PI), silver, T((a.x + b.x) / 2, y - len / 2 + 3, (a.z + b.z) / 2, 0, yaw + Math.PI / 2, 0, 1, 0.15, 1));
    for (const q of [a, b]) if (isFree(ctx, q.x, q.z, 2)) batch.add(taper, bark, T(q.x, q.y + 9, q.z, 0, 0, 0, 1.6, 18, 1.6));
  }

  // Elves on curved walkways near the start: sparse and calm.
  const robes = ['#2E4A44', '#4A5A6A', '#6A7A6A', '#3A3A4A'].map((c) => ctx.ink({ color: c, lineWeight: 0.5 }));
  const face = ctx.ink({ color: '#E0D0C0' });
  for (const [a, b] of zoneRanges(ctx, 'gate')) {
    alongTrack(ctx, { step: 40, off: HW + 6, t0: a, t1: b, side: -1, extra: 2, radius: 6 }, (p, yaw) => {
      const w = W(p.x, p.y, p.z, yaw);
      batch.part(w, new TorusGeometry(6, 0.5, 6, 24, Math.PI), silver, T(0, 3, -3, Math.PI / 2, 0, 0, 1, 1, 1));
      batch.part(w, cyl, silver, T(0, 2.6, -3, 0, 0, 0, 6.2, 0.3, 2));
      crowd(batch, w, 9, 10, 1, 2.75, robes, face, rng, 1.05);
    });
  }

  // Bioluminescent spores drifting over the road and low mist in the hollows.
  for (let i = 0; i < 10; i++) {
    const p = besideExact(ctx, (i + 0.5) / 10, rng.range(-HW * 2, HW * 2));
    emitters.push({ kind: 'spore', rate: 3, position: { x: p.x, y: p.y + 2, z: p.z }, velocity: { x: 0.3, y: 0.5, z: 0.2 }, spread: 3, life: [3, 6], size: [0.18, 0.08] });
  }
  for (let i = 0; i < 8; i++) {
    const p = besideExact(ctx, (i + 0.25) / 8, (i % 2 ? 1 : -1) * (HW + rng.range(8, 20)));
    emitters.push({ kind: 'steam', rate: 1.2, position: { x: p.x, y: p.y + 0.3, z: p.z }, velocity: { x: 0.4, y: 0.25, z: 0 }, spread: 2.5, life: [5, 8], size: [4, 10] });
  }

  // Mist gap under the jump: a glowing pale floor deep below and pale spray.
  for (const j of track.jumps) {
    const mid = (j.gap0 + j.gap1) / 2 / track.length;
    const p = besideExact(ctx, mid, 0);
    for (let k = -1; k <= 1; k++) {
      const q = besideExact(ctx, mid, k * HW);
      emitters.push({ kind: 'steam', rate: 3, position: { x: q.x, y: p.y - 4, z: q.z }, velocity: { x: 0, y: 1, z: 0 }, spread: 2, life: [3, 5], size: [3, 9] });
    }
  }

  // Snowy mountains in the mist, far beyond the trees.
  for (const q of ringAround(ctx, 140, 14)) {
    const h = 60 + rng.next() * 50;
    const y = heightAt(q.x, q.z) - 10;
    const r = 40 + rng.next() * 30;
    batch.add(cone, mountain, T(q.x, y + h / 2, q.z, 0, rng.next() * 6, 0, r, h, r * 0.8));
    batch.add(cone, snow, T(q.x, y + h * 0.85, q.z, 0, 0, 0, r * 0.32, h * 0.3, r * 0.27));
  }

  // Crystal lamp pools along the crystal edges (one draw call).
  for (const smp of track.samples) {
    if (smp.s % 24 > 1) continue;
    for (const s of [-1, 1]) {
      if ((s > 0 ? smp.right : smp.left) !== 'crystal') continue;
      cyanPools.push({ x: smp.x - smp.tz * s * (HW + 1), y: smp.y, z: smp.z + smp.tx * s * (HW + 1), r: 4 });
    }
  }
  glowPools(scene, cyanPools, P.cyan, 0.16);
  // A couple of real lights in the canopy (cold) near the start.
  for (const t of [0.02, 0.5]) {
    const p = besideExact(ctx, t, 0);
    const l = new PointLight(P.cyan, tunables.get('light.furnaceIntensity') * 0.8, 30, 2);
    l.position.set(p.x, p.y + 9, p.z);
    scene.add(l);
    localLights.push(l);
  }
  batch.flush(scene);
}

/** The Mother Tree (landmark): a colossal trunk with a mage carved in it, glowing roots and crown. */
function motherTree(ctx: WorldContext, x: number, z: number, facing: number, r: number): void {
  const { tex, scene, localLights, emitters } = ctx;
  const g = new Group();
  const bark = ctx.ink({ map: tex.bark, mapping: 'world', mapScale: 0.08, color: '#A8A296' });
  const leaf = ctx.ink({ color: '#1A4A44', emissive: P.leaf, emissiveIntensity: 1.3, emissivePreset: 'rune', phase: 1 });
  const leafB = ctx.ink({ color: '#1A3A4A', emissive: '#2A9AC0', emissiveIntensity: 1.2, emissivePreset: 'rune', phase: 3 });
  const marble = ctx.ink({ color: '#D8DCD4' });
  const rune = ctx.ink({ color: '#000000', emissive: P.cyan, emissiveIntensity: 4, emissivePreset: 'rune', hatch: false, lineWeight: 0.3 });
  const windowMat = ctx.ink({ color: '#000000', emissive: P.window, emissiveIntensity: 3, emissivePreset: 'fire', hatch: false });
  const add = (geo: BufferGeometry, mat: InkLitMaterial, px: number, py: number, pz: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => {
    const m = new Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.scale.set(sx, sy, sz);
    m.rotation.set(rx, ry, rz);
    g.add(m);
    return m;
  };
  // Below the board camera (about 67 m up), with a crown that stays clear of the curve around it.
  const R = Math.min(r * 0.32, 8);
  const H = 34;
  add(new CylinderGeometry(R * 0.7, R, H, 20), bark, 0, H / 2, 0);
  // Root flares with glowing rune veins.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    add(new CylinderGeometry(R * 0.2, R * 0.35, R * 2.4, 8), bark, Math.cos(a) * R * 1.3, 1.5, Math.sin(a) * R * 1.3, 1, 1, 1, Math.sin(a) * 1.15, 0, -Math.cos(a) * 1.15);
    add(new CylinderGeometry(0.15, 0.15, R * 2.2, 4), rune, Math.cos(a) * R * 1.35, 2.2, Math.sin(a) * R * 1.35, 1, 1, 1, Math.sin(a) * 1.15, 0, -Math.cos(a) * 1.15);
  }
  // Crown: layered glowing canopies.
  add(new SphereGeometry(1, 20, 12), leaf, 0, H + 2, -R * 0.5, R * 2.1, 7, R * 2.1);
  add(new SphereGeometry(1, 16, 10), leafB, R, H - 7, -R, R * 1.4, 4.5, R * 1.4);
  add(new SphereGeometry(1, 16, 10), leaf, -R * 1.1, H - 11, -R * 0.4, R * 1.2, 4, R * 1.2);
  // The mage carved in the trunk, facing the road (+Z): robe, hood, raised staff with a crystal.
  const front = R * 0.86;
  add(new CylinderGeometry(0, 3.2, 14, 10), marble, 0, 12, front);
  add(new SphereGeometry(1.5, 12, 8), marble, 0, 20.2, front + 0.2);
  add(new CylinderGeometry(0, 1.9, 3, 10), marble, 0, 21.6, front);
  add(new CylinderGeometry(0.25, 0.25, 20, 6), marble, 3, 16, front + 0.6, 1, 1, 1, 0, 0, -0.08);
  const orb = add(new SphereGeometry(1.4, 16, 10), rune, 3.8, 26.5, front + 0.6);
  // Windows and a doorway in the bark.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.5;
    add(new CylinderGeometry(0.6, 0.6, 0.1, 8), windowMat, Math.sin(a) * R * 0.8, 22 + i * 1.8, Math.cos(a) * R * 0.8, 1, 1.6, 1, Math.PI / 2, a, 0);
  }
  const light = new PointLight(P.cyan, tunables.get('light.furnaceIntensity') * 1.6, 40, 2);
  light.position.set(3.8, 26, front + 6);
  g.add(light);
  localLights.push(light);
  ctx.place(g, x, z, facing);
  const pool = lightPool(P.cyan, R * 2.6, 0.18);
  pool.position.set(x, ctx.heightAt(x, z) + 0.08, z);
  scene.add(pool);
  emitters.push({ kind: 'spore', rate: 8, position: { x, y: ctx.heightAt(x, z) + 30, z }, velocity: { x: 0, y: -0.2, z: 0 }, spread: 6, life: [4, 7], size: [0.25, 0.1] });
  ctx.animate((_dt, time) => orb.scale.setScalar(1 + Math.sin(time * 1.7) * 0.08));
}
