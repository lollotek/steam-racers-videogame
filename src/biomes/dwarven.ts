/**
 * Dwarven deep-hall — *Runegate Deep* (doc 04 §7.1). Indoor: no sky, a cold shaft of light from
 * above, warm forges. Square, carved, symmetric: a regular colonnade of basalt pillars, ancestor
 * kings along the Descent, rune pylons, mine carts and conveyors, holographic rune maps and the
 * Rune Engine on its stepped dais at the bottom of the hold.
 */
import {
  BoxGeometry,
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
import { gearGeometry, type PropDef, type PropKit } from '../game/dressing';
import type { BiomeDef, WorldContext } from '../world/biome';
import { lavaMaterial, lightPool } from '../world/kit';
import { Batch, T, W, alongTrack, heightLimit, besideExact, crowd, glowMaterial, glowPools, inZones, isFree, paint, ringAround, yawToTrack, zoneRanges } from './common';

const P = {
  ink: '#0F1216',
  basalt: '#2E333B',
  stone: '#565A60',
  brass: '#9C7A3C',
  gold: '#D2A64A',
  forge: '#FF7A2A',
  seal: '#3FC8FF',
  core: '#FF3F6E',
  fog: '#141A22',
};

export const DWARVEN: BiomeDef = {
  id: 'dwarven',
  name: 'Runegate Deep',
  tunables: {
    'fog.color': P.fog,
    'fog.density': 0.009,
    'fog.start': 55,
    'fog.heightFalloff': 0.06,
    'light.keyColor': '#8FA6C8',
    'light.keyIntensity': 4.0,
    'light.keyPitch': 74,
    'light.keyYaw': 200,
    'light.skyColor': '#33404E',
    'light.groundColor': '#1E1612',
    'light.ambient': 3.4,
    'light.furnaceIntensity': 750,
    'light.furnaceRange': 26,
    'ink.color': P.ink,
    'ink.shadowColor': '#1C222C',
    'ink.litTint': '#E6EEFF',
    'post.lift': '#0A0D12',
    'post.gain': '#EEF2FF',
    'post.saturation': 0.88,
    'post.exposure': 1.45,
    'post.bloomStrength': 0.8,
    'fx.wind': 0.4,
  },
  ground: { tex: 'dirt', tint: '#5A5650', scale: 1 / 10 },
  surfaces: {
    flagstone: { tex: 'flagstone', scale: 1, tint: '#D4D0CA' },
    rails: { tex: 'rails', scale: 1, tint: '#D0C8C0' },
    grate: { tex: 'grate', scale: 2, tint: '#E0D0C0' },
  },
  skirt: { tex: 'flagstone', tint: '#6E737A', scale: 0.12 },
  gantry: { lines: ['RUNEGATE DEEP'], bg: P.basalt, fg: P.gold },
  clearView: true,
  pit: 'lava',
  debris: { color: '#4A4E54', scale: 0.6 },
  theme: { density: 1, other: 0, own: 1, mul: { barrel: 0.6, crates: 0.8, brazier: 1.2, rocks: 0.6 } },
  themes: {
    stone: { density: 1, other: 0, own: 1, mul: { barrel: 0.6, crates: 0.8, brazier: 1.2, rocks: 0.6 } },
    runepylon: { density: 0.9, other: 0, own: 1, mul: { runeCrate: 3, crates: 0.8, rocks: 0.4 } },
    riveted: { density: 1, other: 0, own: 1, mul: { forgeBlock: 3, runeBoiler: 2, pipes: 1.5, barrel: 1, crates: 1, brazier: 1.5, oreCart: 0.6 } },
  },
  props,
  decorate,
  landmark(ctx, lm) {
    if (lm.id !== 'rune-engine') return false;
    runeEngine(ctx, lm.x, lm.z, lm.facing, lm.r);
    return true;
  },
};

/** Dressing props of the hold (edge: carts, crates, anvils; mid: forges; far: columns, gears). */
function props(k: PropKit): PropDef[] {
  const { M, g, ink, tex } = k;
  const stone = ink({ map: tex.flagstone, mapping: 'world', mapScale: 0.3, color: '#8A8E94' });
  const basalt = ink({ map: tex.flagstone, mapping: 'world', mapScale: 0.15, color: '#5A5E66' });
  const brass = k.mats.brass;
  const iron = k.mats.iron;
  const ore = ink({ color: '#000000', emissive: P.forge, emissiveIntensity: 3, emissivePreset: 'lava', hatch: false, lineWeight: 0.3 });
  const seal = ink({ color: '#000000', emissive: P.seal, emissiveIntensity: 3, emissivePreset: 'rune', hatch: false, phase: 1.7 });
  const fire = k.mats.fire;
  const hex = new CylinderGeometry(1, 1, 1, 6);
  const gear = gearGeometry(1, 14, 0.35);
  return [
    { name: 'oreCart', radius: 1.6, bands: ['edge', 'mid'], weight: 3, build: (r) => [
      { geo: g.box, mat: iron, m: M(0, 1, 0, 0, 0, 0, 1.6, 1.1, 2.4) },
      { geo: g.box, mat: brass, m: M(0, 1.56, 0, 0, 0, 0, 1.7, 0.12, 2.5) },
      ...[-0.7, 0.7].flatMap((z) => [-0.85, 0.85].map((x) => ({ geo: g.cylLow, mat: k.mats.dark, m: M(x, 0.35, z, 0, 0, Math.PI / 2, 0.35, 0.18, 0.35) }))),
      ...Array.from({ length: 4 }, () => ({ geo: g.sphere, mat: ore, m: M(r.range(-0.4, 0.4), 1.7, r.range(-0.7, 0.7), 0, 0, 0, r.range(0.3, 0.45)), shadow: false })),
    ] },
    { name: 'runeCrate', radius: 1.4, bands: ['edge', 'mid'], weight: 2, build: (r) => {
      const n = r.int(1, 3);
      return Array.from({ length: n }, (_, i) => [
        { geo: g.box, mat: stone, m: M(i * 1.3 - 0.6, 0.6 + (i === 2 ? 1.2 : 0), 0, 0, r.range(-0.2, 0.2), 0, 1.2) },
        { geo: g.box, mat: seal, m: M(i * 1.3 - 0.6, 0.6 + (i === 2 ? 1.2 : 0), 0.61, 0, 0, 0, 0.5, 0.5, 0.02), shadow: false },
      ]).flat();
    } },
    { name: 'anvil', radius: 1.2, bands: ['edge'], weight: 1.5, build: () => [
      { geo: g.box, mat: stone, m: M(0, 0.4, 0, 0, 0, 0, 1, 0.8, 1) },
      { geo: g.box, mat: iron, m: M(0, 1.0, 0, 0, 0, 0, 0.6, 0.4, 1.4) },
      { geo: g.box, mat: iron, m: M(0, 1.25, 0.2, 0, 0, 0, 0.9, 0.2, 1.6) },
    ] },
    { name: 'cables', radius: 2, bands: ['edge', 'mid'], weight: 1.5, build: (r) => Array.from({ length: 4 }, (_, i) => ({ geo: g.cyl, mat: i % 2 ? k.mats.rubber : brass, m: M(0, 0.2 + i * 0.12, r.range(-0.6, 0.6), 0, r.range(-0.2, 0.2), Math.PI / 2, 0.16, 4.2, 0.16) })) },
    { name: 'forgeBlock', radius: 3, height: 10, bands: ['mid'], weight: 2, emitter: () => ({ local: new Vector3(1.2, 8.2, -0.8), opts: { kind: 'smoke', rate: 3, velocity: { x: 0, y: 2.6, z: 0 }, spread: 0.6, life: [2, 3.5], size: [1, 4] } }), build: () => [
      { geo: g.box, mat: basalt, m: M(0, 2, 0, 0, 0, 0, 4.4, 4, 3.6) },
      { geo: g.box, mat: brass, m: M(0, 4.1, 0, 0, 0, 0, 4.6, 0.3, 3.8) },
      { geo: g.box, mat: fire, m: M(0, 1.5, 1.82, 0, 0, 0, 2.2, 1.6, 0.1), shadow: false },
      { geo: g.cyl, mat: iron, m: M(1.2, 6, -0.8, 0, 0, 0, 0.6, 4, 0.6) },
    ] },
    { name: 'runeBoiler', radius: 2.6, bands: ['mid'], weight: 2, build: () => [
      { geo: g.cyl, mat: iron, m: M(0, 2.2, 0, 0, 0, 0, 1.5, 4.4, 1.5) },
      { geo: g.sphere, mat: brass, m: M(0, 4.4, 0, 0, 0, 0, 1.5, 0.8, 1.5) },
      { geo: g.box, mat: seal, m: M(0, 2.4, 1.52, 0, 0, 0, 1.2, 1.6, 0.04), shadow: false },
      { geo: g.box, mat: stone, m: M(0, 0.25, 0, 0, 0, 0, 3.4, 0.5, 3.4) },
    ] },
    { name: 'basaltColumn', radius: 3, height: 34, bands: ['far'], weight: 3, build: (r) => {
      const h = r.range(18, 34);
      return [
        { geo: hex, mat: basalt, m: M(0, h / 2, 0, 0, r.range(0, 1), 0, 2.4, h, 2.4) },
        { geo: hex, mat: brass, m: M(0, h * 0.35, 0, 0, 0, 0, 2.55, 0.5, 2.55) },
      ];
    } },
    { name: 'giantGear', radius: 5, height: 9, bands: ['far'], weight: 1.5, build: (r) => [{ geo: gear, mat: r.next() > 0.5 ? brass : iron, m: M(0, 3.5, 0, Math.PI / 2, 0, 0, 5) }] },
  ];
}

function decorate(ctx: WorldContext): void {
  const { scene, track, tex, rng, emitters, localLights, heightAt } = ctx;
  const HW = track.halfWidth;
  const batch = new Batch();
  const basalt = ctx.ink({ map: tex.flagstone, mapping: 'world', mapScale: 0.12, color: '#6A6E76' });
  const stone = ctx.ink({ map: tex.flagstone, mapping: 'world', mapScale: 0.25, color: '#8E9298' });
  const brass = ctx.ink({ map: tex.brass, mapping: 'world', mapScale: 0.5, sheen: 0.8 });
  const gold = ctx.ink({ map: tex.brass, mapping: 'world', mapScale: 0.5, color: '#FFE0A0', sheen: 1 });
  const iron = ctx.ink({ map: tex.iron, mapping: 'world', mapScale: 0.3 });
  const forgeRune = ctx.ink({ color: '#000000', emissive: P.forge, emissiveIntensity: 3.5, emissivePreset: 'rune', hatch: false, lineWeight: 0.2 });
  const sealRune = ctx.ink({ color: '#000000', emissive: P.seal, emissiveIntensity: 3.5, emissivePreset: 'rune', hatch: false, lineWeight: 0.2, phase: 2 });
  const fire = ctx.ink({ color: '#000000', emissive: '#FF8A2A', emissiveIntensity: 6, emissivePreset: 'fire', hatch: false, lineWeight: 0.3 });
  const box = new BoxGeometry(1, 1, 1);
  const cyl = new CylinderGeometry(1, 1, 1, 12);
  const oct = new CylinderGeometry(1, 1, 1, 8);
  const cone4 = new CylinderGeometry(0, 1, 1, 4);
  const flame = new CylinderGeometry(0, 0.5, 1.1, 7);
  const warmPools: { x: number; y: number; z: number; r: number }[] = [];
  const coldPools: { x: number; y: number; z: number; r: number }[] = [];

  // Colonnade: square basalt pillars at a regular spacing on both sides, rising into the dark.
  // On the camera side of the road they are broken stumps, so they never hide the racing line.
  alongTrack(ctx, { step: 24, off: HW + 6.5, extra: 1, radius: 2.4 }, (p, yaw, t, side) => {
    const h = Math.min(32, heightLimit(ctx, p.x, p.z, 1.6));
    if (h < 3) return;
    const w = W(p.x, p.y, p.z, yaw);
    const runeMat = Math.round(t * 50 + side) % 2 ? forgeRune : sealRune;
    batch.part(w, box, basalt, T(0, h / 2, 0, 0, 0, 0, 3.2, h, 3.2));
    batch.part(w, box, stone, T(0, 0.6, 0, 0, 0, 0, 4.2, 1.2, 4.2));
    for (const y of [5, 12]) if (y < h - 1) batch.part(w, box, brass, T(0, y, 0, 0, 0, 0, 3.5, 0.45, 3.5));
    // Carved rune strip on the face towards the road: forge orange or seal cyan, alternating.
    if (h > 11.5) batch.part(w, box, runeMat, T(0, 8.5, 1.62, 0, 0, 0, 0.5, 5, 0.06), false);
    else batch.part(w, box, runeMat, T(0, h * 0.55, 1.62, 0, 0, 0, 0.5, Math.min(2, h * 0.4), 0.06), false);
    // Cable bundle between the pillar tops (hint of the hold's machinery).
    if (h > 23) batch.part(w, cyl, iron, T(0, 22, 0, 0, 0, Math.PI / 2, 0.25, 3.4, 0.25));
  });

  // Braziers on the inner edge: fire, a warm light pool and a few real lights (capped by quality).
  let lights = 0;
  alongTrack(ctx, { step: 70, off: HW + 2.6, radius: 1.4 }, (p, yaw, t, side) => {
    if (Math.round(t * 20) % 2 !== (side > 0 ? 0 : 1)) return;
    const w = W(p.x, p.y, p.z, yaw);
    batch.part(w, oct, stone, T(0, 0.6, 0, 0, 0, 0, 0.9, 1.2, 0.9));
    batch.part(w, oct, iron, T(0, 1.35, 0, 0, 0, 0, 1.1, 0.35, 1.1));
    batch.part(w, flame, fire, T(0, 2.1, 0, 0, 0, 0, 1.4, 1.3, 1.4), false);
    warmPools.push({ x: p.x, y: p.y, z: p.z, r: 8 });
    emitters.push({ kind: 'ember', rate: 4, position: { x: p.x, y: p.y + 2.2, z: p.z }, velocity: { x: 0, y: 2.6, z: 0 }, spread: 0.6, life: [0.8, 1.6], size: [0.25, 0.1] });
    if (lights < 6) {
      const l = new PointLight('#FF8A3A', tunables.get('light.furnaceIntensity'), tunables.get('light.furnaceRange'), 2);
      l.position.set(p.x, p.y + 3, p.z);
      scene.add(l);
      localLights.push(l);
      lights++;
    }
  });

  // Ancestor kings along the Descent and the Ascent: carved stone, gold trims, axes.
  const statues = [...zoneRanges(ctx, 'descent'), ...zoneRanges(ctx, 'ascent')];
  alongTrack(ctx, { step: 34, off: HW + 10, extra: 3, radius: 4, where: (t) => inZones(statues, t) }, (p, yaw) => {
    if (heightLimit(ctx, p.x, p.z, 2.5) < 16) return;
    const w = W(p.x, p.y, p.z, yaw);
    batch.part(w, box, stone, T(0, 1.2, 0, 0, 0, 0, 5, 2.4, 5));
    batch.part(w, box, gold, T(0, 2.45, 0, 0, 0, 0, 5.2, 0.2, 5.2));
    batch.part(w, cone4, basalt, T(0, 7.5, 0, 0, Math.PI / 4, 0, 2.6, 10, 2.2)); // robe
    batch.part(w, box, basalt, T(0, 12.4, 0, 0, 0, 0, 3.6, 1.6, 2.4)); // shoulders
    batch.part(w, box, stone, T(0, 14, 0.1, 0, 0, 0, 1.7, 1.9, 1.7)); // head
    batch.part(w, cone4, stone, T(0, 11.6, 1.0, Math.PI, Math.PI / 4, 0, 1.2, 4.2, 0.6)); // beard
    batch.part(w, box, gold, T(0, 15.2, 0.1, 0, 0, 0, 2, 0.5, 2)); // crown band
    batch.part(w, box, iron, T(1.2, 9, 1.4, 0, 0, 0, 0.3, 11, 0.3)); // axe haft
    batch.part(w, box, iron, T(1.2, 14, 1.4, 0, 0, 0, 2.6, 2, 0.2)); // axe blade
    batch.part(w, box, sealRune, T(0, 4.5, 2.3, 0, 0, 0, 1.2, 1.2, 0.05), false);
  });

  // Conveyor gantries over the mine sections, carrying glowing ore across the road.
  const ore = ctx.ink({ color: '#000000', emissive: P.forge, emissiveIntensity: 3.5, emissivePreset: 'lava', hatch: false, lineWeight: 0.2 });
  for (const [a, b] of zoneRanges(ctx, 'mine')) {
    const t = (a + b) / 2;
    const L = besideExact(ctx, t, HW + 3);
    const R = besideExact(ctx, t, -(HW + 3));
    const y = Math.max(L.y, R.y) + 9;
    const yaw = Math.atan2(R.x - L.x, R.z - L.z);
    const len = Math.hypot(R.x - L.x, R.z - L.z);
    const mid = W((L.x + R.x) / 2, y, (L.z + R.z) / 2, yaw);
    batch.part(mid, box, iron, T(0, 0, 0, 0, 0, 0, 2.2, 0.6, len + 2));
    batch.part(mid, box, brass, T(0, 0.45, 0, 0, 0, 0, 1.6, 0.3, len + 2));
    for (let k = -len / 2; k < len / 2; k += 2.2) batch.part(mid, box, ore, T(rng.range(-0.4, 0.4), 0.9, k, 0, rng.range(0, 3), 0, 0.7), false);
    for (const q of [L, R]) {
      const h = y - q.y;
      batch.add(box, iron, T(q.x, q.y + h / 2, q.z, 0, yaw, 0, 1, h, 1));
      ctx.reserved.push({ x: q.x, z: q.z, r: 2 });
    }
  }

  // Magma channel under the forge grate (vent hazard): lava both sides, light and embers.
  for (const h of track.hazards) {
    if (h.kind !== 'vent') continue;
    const lava = lavaMaterial(tex.noise);
    const channel = new PlaneGeometry(34, h.length + 1);
    channel.rotateX(-Math.PI / 2);
    for (const side of [-1, 1]) {
      // The channel runs across the road: local X is the driver's right (-cos h, sin h) axis.
      const m = new Mesh(channel, lava);
      m.rotation.y = h.heading;
      const off = side * (HW + 17.5);
      const x = h.x - Math.cos(h.heading) * off;
      const z = h.z + Math.sin(h.heading) * off;
      m.position.set(x, heightAt(x, z) + 0.15, z);
      scene.add(m);
      ctx.reserved.push({ x, z, r: 14 });
      for (let k = 0; k < 3; k++) {
        const ex = h.x - Math.cos(h.heading) * side * (HW + 4 + k * 9);
        const ez = h.z + Math.sin(h.heading) * side * (HW + 4 + k * 9);
        emitters.push({ kind: 'ember', rate: 6, position: { x: ex, y: heightAt(ex, ez) + 0.5, z: ez }, velocity: { x: 0, y: 3, z: 0 }, spread: 1.6, life: [1, 2.2], size: [0.3, 0.1] });
        emitters.push({ kind: 'steam', rate: 1.5, position: { x: ex, y: heightAt(ex, ez) + 0.5, z: ez }, velocity: { x: 0, y: 2, z: 0 }, spread: 1.2, life: [2, 3.5], size: [2, 6] });
      }
    }
    const l = new PointLight('#FF6A1A', tunables.get('light.furnaceIntensity') * 1.4, tunables.get('light.furnaceRange') * 1.3, 2);
    l.position.set(h.x, h.y + 4, h.z);
    scene.add(l);
    localLights.push(l);
    warmPools.push({ x: h.x, y: h.y, z: h.z, r: 18 });
  }

  // Cold light shafts from the vault (additive cones) with floating dust.
  const shaftMat = glowMaterial('#8FB0D8', 0.045);
  shaftMat.side = DoubleSide;
  const shaftGeo = new CylinderGeometry(3, 7, 46, 16, 1, true);
  for (let i = 0; i < 7; i++) {
    const t = (i + 0.3) / 7;
    const p = besideExact(ctx, t, (i % 2 ? 1 : -1) * rng.range(0, HW + 4));
    const m = new Mesh(shaftGeo, shaftMat);
    m.position.set(p.x, p.y + 23, p.z);
    m.renderOrder = 7;
    scene.add(m);
    coldPools.push({ x: p.x, y: p.y, z: p.z, r: 9 });
    emitters.push({ kind: 'dust', rate: 1.2, position: { x: p.x, y: p.y + 6, z: p.z }, velocity: { x: 0, y: 0.4, z: 0 }, spread: 2.5, life: [4, 7], size: [0.4, 1.2] });
  }

  // Holographic rune maps: translucent cyan planes with a wireframe terrain, bobbing slowly.
  const holoTex = paint(512, 320, (c) => {
    c.fillStyle = '#000';
    c.fillRect(0, 0, 512, 320);
    c.strokeStyle = '#7FE8FF';
    c.lineWidth = 2;
    for (let row = 0; row < 14; row++) {
      c.beginPath();
      for (let x = 0; x <= 512; x += 16) {
        const y = 40 + row * 18 - 30 * Math.exp(-((x - 260 - row * 6) ** 2) / 9000) * Math.sin(row * 0.6 + x * 0.02);
        if (x === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
    }
    c.strokeStyle = '#FFFFFF';
    c.lineWidth = 3;
    c.strokeRect(6, 6, 500, 308);
    c.globalAlpha = 0.25;
    for (let y = 0; y < 320; y += 4) c.fillRect(0, y, 512, 1);
  });
  const holoMat = glowMaterial(P.seal, 0.45, holoTex);
  holoMat.side = DoubleSide;
  const holos: { m: Mesh; y: number; ph: number }[] = [];
  for (const t of [0.12, 0.48, 0.8]) {
    const p = [1, -1].map((s) => besideExact(ctx, t, s * (HW + 18))).find((q) => isFree(ctx, q.x, q.z, 6) && heightLimit(ctx, q.x, q.z, 0) > 19 && ctx.distToTrack(q.x, q.z) > HW + 12);
    if (!p) continue;
    const m = new Mesh(new PlaneGeometry(16, 10), holoMat);
    const y = p.y + 13;
    m.position.set(p.x, y, p.z);
    m.rotation.y = yawToTrack(ctx, t, p.x, p.z);
    m.renderOrder = 8;
    scene.add(m);
    holos.push({ m, y, ph: t * 10 });
  }
  ctx.animate((_dt, time) => {
    for (const h of holos) h.m.position.y = h.y + Math.sin(time * 0.6 + h.ph) * 0.6;
  });

  // Stone galleries with armoured dwarves and lanterns on the start straight.
  const crowdMats = ['#4A505A', '#6A5A48', '#5A4A3E', '#3E4450'].map((c) => ctx.ink({ color: c, lineWeight: 0.5 }));
  const head = ctx.ink({ color: '#B08A70' });
  for (const [a, b] of zoneRanges(ctx, 'gate')) {
    alongTrack(ctx, { step: 30, off: HW + 9, t0: a, t1: b, side: -1, extra: 4, radius: 7 }, (p, yaw) => {
      const w = W(p.x, p.y, p.z, yaw);
      batch.part(w, box, stone, T(0, 1.5, 0, 0, 0, 0, 14, 3, 5));
      batch.part(w, box, stone, T(0, 3.4, -1.4, 0, 0, 0, 14, 0.8, 2.2));
      crowd(batch, w, 22, 12, 1.6, 3, crowdMats, head, rng);
      crowd(batch, w, 16, 12, 1.4, 3.8, crowdMats, head, rng);
      batch.part(w, box, forgeRune, T(-6.5, 4, 2.4, 0, 0, 0, 0.6, 0.9, 0.6), false);
      batch.part(w, box, forgeRune, T(6.5, 4, 2.4, 0, 0, 0, 0.6, 0.9, 0.6), false);
    });
  }

  // The hold itself: tall basalt walls with brass ribs, lost in the dark.
  for (const q of ringAround(ctx, 70, 26)) {
    const y = heightAt(q.x, q.z);
    const w = W(q.x, y, q.z, -q.a + Math.PI / 2);
    batch.part(w, box, basalt, T(0, 30, 0, 0, 0, 0, (2 * Math.PI * q.r) / 26 + 2, 60, 8));
    batch.part(w, box, brass, T(0, 30, -4.5, 0, 0, 0, 2, 60, 1.5));
    batch.part(w, box, forgeRune, T(6, 8, -4.3, 0, 0, 0, 1, 6, 0.1), false);
  }

  glowPools(scene, warmPools, '#FF8A2A', 0.24);
  glowPools(scene, coldPools, '#8FB0D8', 0.16);
  batch.flush(scene);
}

/** The Rune Engine (landmark): stepped dais, black stone and gold, pulsing core, turning gears. */
function runeEngine(ctx: WorldContext, x: number, z: number, facing: number, r: number): void {
  const { tex, scene, localLights, emitters } = ctx;
  const g = new Group();
  const black = ctx.ink({ map: tex.flagstone, mapping: 'world', mapScale: 0.2, color: '#3A3E46' });
  const stone = ctx.ink({ map: tex.flagstone, mapping: 'world', mapScale: 0.2, color: '#7A7E86' });
  const gold = ctx.ink({ map: tex.brass, mapping: 'world', mapScale: 0.4, color: '#FFE0A0', sheen: 1 });
  const forge = ctx.ink({ color: '#000000', emissive: P.forge, emissiveIntensity: 4, emissivePreset: 'rune', hatch: false, lineWeight: 0.2 });
  const core = ctx.ink({ color: '#000000', emissive: P.core, emissiveIntensity: 7, emissivePreset: 'rune', hatch: false, lineWeight: 0.6 });
  const add = (geo: BufferGeometry, mat: typeof stone, px: number, py: number, pz: number, rx = 0, ry = 0, rz = 0) => {
    const m = new Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.rotation.set(rx, ry, rz);
    g.add(m);
    return m;
  };
  const R = Math.min(r, 15);
  // Dais: three octagonal steps with carved forge runes on the risers.
  [1, 0.78, 0.56].forEach((k, i) => {
    add(new CylinderGeometry(R * k, R * k + 0.4, 1.3, 8), i % 2 ? stone : black, 0, 0.65 + i * 1.3, 0);
    add(new TorusGeometry(R * k + 0.05, 0.12, 4, 8), gold, 0, 1.3 + i * 1.3, 0, Math.PI / 2, 0, Math.PI / 8);
    add(new BoxGeometry(R * k * 0.5, 0.35, 0.08), forge, 0, 0.65 + i * 1.3, R * k * 0.93);
  });
  const top = 3.9;
  // Engine body with a gold frame and the core window towards the track.
  add(new BoxGeometry(7, 9, 5), black, 0, top + 4.5, -1);
  for (const sx of [-1, 1]) {
    add(new BoxGeometry(1.2, 12, 1.2), gold, sx * 4.2, top + 6, 1.2);
    add(new CylinderGeometry(0.7, 0.7, 10, 10), gold, sx * 3, top + 5, -3.8, 0, 0, 0);
  }
  add(new BoxGeometry(9.6, 1.2, 1.6), gold, 0, top + 12, 1.2);
  add(new TorusGeometry(2.8, 0.45, 8, 24), gold, 0, top + 5.5, 1.6);
  const coreMesh = add(new SphereGeometry(2.3, 20, 14), core, 0, top + 5.5, 1.4);
  // Gears behind the body, turning slowly in opposite directions.
  const gearA = add(gearGeometry(5, 16, 0.8), gold, -3.5, top + 7, -4.2, Math.PI / 2, 0, 0);
  const gearB = add(gearGeometry(3.6, 12, 0.8), stone, 4.2, top + 9.5, -3.9, Math.PI / 2, 0, 0);
  const light = new PointLight(P.core, tunables.get('light.furnaceIntensity') * 1.5, 32, 2);
  light.position.set(0, top + 5.5, 5);
  g.add(light);
  localLights.push(light);
  ctx.place(g, x, z, facing);
  const pool = lightPool(P.core, R * 1.3, 0.2);
  pool.position.set(x, ctx.heightAt(x, z) + 0.08, z);
  scene.add(pool);
  emitters.push({ kind: 'steam', rate: 3, position: { x, y: ctx.heightAt(x, z) + top + 12, z }, velocity: { x: 0, y: 2.5, z: 0 }, spread: 1, life: [2, 3.5], size: [2, 6] });
  ctx.animate((dt, time) => {
    gearA.rotation.y += dt * 0.25;
    gearB.rotation.y -= dt * 0.35;
    coreMesh.scale.setScalar(1 + Math.sin(time * 2) * 0.05);
  });
}
