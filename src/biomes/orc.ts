/**
 * Orc scrapyard — *Rustmaw Pit* (doc 04 §7.3). A scrap city on the crater rim in the desert:
 * the only open sky, a low hot sun through dust. Chaos and asymmetry: leaning scrap towers with
 * horns and tusks of rift creatures, crude red and toxic-green neon from stolen rune crystals,
 * cranes swinging magnets, furnaces with black smoke, scrap mountains, mesas, and the Warlord
 * idol (one tusk broken, a boiler on the back, a furnace in the chest) at the end of the straight.
 */
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  PointLight,
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
  ink: '#1C1208',
  rust: '#7A4422',
  scrap: '#5E564A',
  sand: '#B08A5A',
  bone: '#D8C8A8',
  toxic: '#6CFF3A',
  blood: '#FF2A2A',
  sun: '#FFC07A',
  fog: '#A08C70',
};

/** Clan sigil (doc 04 §7.3, original): a broken cogwheel bitten by a tusked jaw. */
function sigilTexture(color: string) {
  return paint(256, 256, (c) => {
    c.fillStyle = '#000';
    c.fillRect(0, 0, 256, 256);
    c.strokeStyle = '#fff';
    c.lineWidth = 12;
    c.lineCap = 'round';
    c.shadowColor = '#fff';
    c.shadowBlur = 10;
    c.translate(128, 120);
    // Broken cog: teeth on two thirds of the rim, a jagged gap.
    c.beginPath();
    for (let i = 0; i <= 16; i++) {
      const a = 0.9 + (i / 24) * Math.PI * 2;
      const rr = i % 2 ? 66 : 82;
      c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    c.stroke();
    // Jaw with two tusks biting into the gap.
    c.beginPath();
    c.moveTo(-70, 40);
    c.quadraticCurveTo(0, 110, 70, 40);
    c.stroke();
    c.beginPath();
    c.moveTo(-40, 66);
    c.lineTo(-58, 6);
    c.moveTo(40, 66);
    c.lineTo(52, 14);
    c.stroke();
    void color;
  });
}

export const ORC: BiomeDef = {
  id: 'orc',
  name: 'Rustmaw Pit',
  tunables: {
    'fog.color': P.fog,
    'fog.density': 0.0085,
    'fog.start': 55,
    'fog.heightFalloff': 0.12,
    'light.keyColor': '#FFD6A8',
    'light.keyIntensity': 4.8,
    'light.keyPitch': 26,
    'light.keyYaw': 250,
    'light.skyColor': '#B4A890',
    'light.groundColor': '#4A3A2A',
    'light.ambient': 2.4,
    'light.furnaceIntensity': 650,
    'light.furnaceRange': 22,
    'ink.color': P.ink,
    'ink.shadowColor': '#3A2414',
    'ink.litTint': '#FFF0DC',
    'post.lift': '#1A0E06',
    'post.gain': '#FFF2E4',
    'post.saturation': 0.9,
    'post.contrast': 1.12,
    'post.bloomStrength': 0.65,
    'fx.wind': 3,
  },
  ground: { tex: 'dirt', tint: '#A88C68', scale: 1 / 12 },
  surfaces: {
    sand: { tex: 'dirt', scale: 2, tint: '#E8DCC4' },
    scrap: { tex: 'plates', scale: 1, tint: '#B8ACA0' },
    mud: { tex: 'dirt', scale: 2, tint: '#8A6648', sheen: 0.5 },
    oil: { tex: 'plates', tint: '#4A403A', sheen: 0.8 },
  },
  skirt: { tex: 'rust', tint: '#B08060', scale: 0.25 },
  gantry: { lines: ['RUSTMAW PIT'], bg: '#3A2414', fg: P.toxic },
  clearView: true,
  pit: 'dark',
  debris: { color: '#5A4430', scale: 0.8 },
  theme: { density: 1, other: 0.6, own: 1, mul: { boiler: 0, generator: 0, pipes: 0, bigGear: 0.3, tank: 0, chimney: 0, tower: 0, brazier: 0.8, bunker: 0, sandbags: 0.3 } },
  themes: {
    tyres: { density: 1, other: 1, own: 1, mul: { tyres: 4, wreck: 2, barrel: 2, scrapSmall: 2, boiler: 0, generator: 0, pipes: 0, tank: 0, chimney: 0, tower: 0, bunker: 0, bigGear: 0.2, sandbags: 0 } },
    wreckwall: { density: 1, other: 1, own: 1.2, mul: { wreck: 4, scrapPile: 3, scrapSmall: 2, hornPost: 2, boiler: 0, generator: 0, pipes: 0, tank: 0, chimney: 0, tower: 0, bunker: 0, sandbags: 0 } },
    hedgehog: { density: 1, other: 0.6, own: 1, mul: { hedgehogs: 5, scrapPile: 2, spikeFence: 2, bones: 2, boiler: 0, generator: 0, pipes: 0, tank: 0, chimney: 0, tower: 0, bunker: 0, sandbags: 0 } },
    corrugated: { density: 1, other: 0.8, own: 1, mul: { shack: 5, scrapTower: 3, barrel: 2, crates: 1.5, boiler: 0, generator: 0, pipes: 0, tank: 0, chimney: 0, tower: 0, bunker: 0, sandbags: 0 } },
    barbed: { density: 0.75, other: 0.15, own: 0.6, mul: { wireCoil: 6, bones: 3, rocks: 3, spikeFence: 2, wreck: 1 } },
  },
  props,
  decorate,
  landmark(ctx, lm) {
    if (lm.id !== 'warlord-idol') return false;
    warlordIdol(ctx, lm.x, lm.z, lm.facing);
    return true;
  },
};

function props(k: PropKit): PropDef[] {
  const { M, g, ink, tex } = k;
  const bone = ink({ color: P.bone });
  const rust = k.mats.rust;
  const sheet = ink({ map: tex.iron, mapping: 'world', mapScale: 0.5, color: '#C0A890' });
  const rock = ink({ map: tex.dirt, mapping: 'world', mapScale: 0.15, color: '#B07A50' });
  const neonG = ink({ color: '#000000', emissive: P.toxic, emissiveIntensity: 3.5, emissivePreset: 'neon', hatch: false, phase: 3.3 });
  const neonR = ink({ color: '#000000', emissive: P.blood, emissiveIntensity: 3.5, emissivePreset: 'neon', hatch: false, phase: 6.1 });
  const horn = new CylinderGeometry(0, 1, 1, 7);
  return [
    { name: 'bones', radius: 2, bands: ['edge', 'mid'], weight: 1.5, build: (r) => [
      ...Array.from({ length: 4 }, (_, i) => ({ geo: g.cyl, mat: bone, m: M(0, 0.3, -1.2 + i * 0.8, 0, 0, 1.2 - i * 0.2, 0.18, r.range(1.4, 2.4), 0.18) })),
      { geo: g.sphere, mat: bone, m: M(r.range(-1, 1), 0.5, r.range(-1, 1), 0, 0, 0, 0.7, 0.55, 0.8) },
    ] },
    { name: 'hornPost', radius: 1.6, bands: ['edge', 'mid'], weight: 1, build: (r) => [
      { geo: g.box, mat: rust, m: M(0, 1.5, 0, 0, 0, r.range(-0.1, 0.1), 0.6, 3, 0.6) },
      { geo: horn, mat: bone, m: M(0.6, 3.4, 0, 0, 0, -0.9, 0.5, 2.6, 0.5) },
      { geo: horn, mat: bone, m: M(-0.6, 3.4, 0, 0, 0, 0.9, 0.5, 2.6, 0.5) },
    ] },
    { name: 'scrapTower', radius: 4, height: 20, bands: ['mid', 'far'], weight: 2, build: (r) => {
      const parts: Part[] = [];
      let y = 0;
      const n = r.int(3, 5);
      for (let i = 0; i < n; i++) {
        const w = r.range(3.5, 6) * (1 - i * 0.12);
        const h = r.range(2.4, 3.6);
        parts.push({ geo: g.box, mat: r.next() > 0.5 ? rust : sheet, m: M(r.range(-0.6, 0.6), y + h / 2, r.range(-0.6, 0.6), r.range(-0.08, 0.08), r.range(-0.4, 0.4), r.range(-0.1, 0.1), w, h, w * r.range(0.7, 1)) });
        y += h;
      }
      parts.push({ geo: horn, mat: bone, m: M(1.6, y - 0.5, 0, 0, 0, -0.7, 0.7, 4, 0.7) });
      parts.push({ geo: horn, mat: bone, m: M(-1.4, y - 1, 0.4, 0.3, 0, 0.8, 0.6, 3.4, 0.6) });
      parts.push({ geo: g.box, mat: r.next() > 0.5 ? neonG : neonR, m: M(0, y * 0.6, 2.4, 0, 0, r.range(-0.2, 0.2), 2.4, 0.5, 0.05), shadow: false });
      return parts;
    } },
    { name: 'furnace', radius: 3, height: 11, bands: ['mid'], weight: 1.2, emitter: () => ({ local: new Vector3(0, 9, 0), opts: { kind: 'smoke', rate: 5, velocity: { x: 0, y: 3.4, z: 0 }, spread: 0.8, life: [4, 7], size: [3, 10] } }), build: () => [
      { geo: g.cyl, mat: rust, m: M(0, 2.5, 0, 0, 0, 0, 2.4, 5, 2.4) },
      { geo: g.box, mat: k.mats.fire, m: M(0, 1.6, 2.3, 0, 0, 0, 1.8, 1.4, 0.3), shadow: false },
      { geo: g.cyl, mat: k.mats.iron, m: M(0, 7, 0, 0, 0, 0, 0.8, 4, 0.8) },
    ] },
    { name: 'mesa', radius: 14, height: 26, bands: ['far'], weight: 1.2, build: (r) => {
      const h = r.range(14, 26);
      return [
        { geo: g.cylLow, mat: rock, m: M(0, h / 2, 0, 0, r.range(0, 6), 0, r.range(10, 14), h, r.range(8, 12)) },
        { geo: g.cylLow, mat: rock, m: M(r.range(-4, 4), h * 0.25, r.range(-4, 4), 0, 0, 0, 14, h * 0.5, 13) },
      ];
    } },
    { name: 'scrapMountain', radius: 10, height: 13, bands: ['far'], weight: 2, build: (r) => {
      const parts: Part[] = [{ geo: g.cone, mat: r.next() > 0.5 ? rust : sheet, m: M(0, 6, 0, 0, r.range(0, 6), 0, 11, 12, 10) }];
      for (let i = 0; i < 8; i++) parts.push({ geo: g.box, mat: r.pick([rust, sheet, k.mats.iron]), m: M(r.range(-7, 7), r.range(0.5, 7), r.range(-7, 7), r.range(-1, 1), r.range(0, 6), r.range(-1, 1), r.range(1.5, 4), r.range(0.4, 1.5), r.range(1.5, 4)) });
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
  const horn = new CylinderGeometry(0, 1, 1, 7);
  const rust = ctx.ink({ map: tex.rust, mapping: 'world', mapScale: 0.3 });
  const sheet = ctx.ink({ map: tex.iron, mapping: 'world', mapScale: 0.4, color: '#C8B098' });
  const iron = ctx.ink({ map: tex.iron, mapping: 'world', mapScale: 0.3 });
  const bone = ctx.ink({ color: P.bone });
  const rock = ctx.ink({ map: tex.dirt, mapping: 'world', mapScale: 0.1, color: '#A87048' });
  const neonG = ctx.ink({ color: '#000000', emissiveMap: sigilTexture(P.toxic), emissive: P.toxic, emissiveIntensity: 4, emissivePreset: 'neon', hatch: false, phase: 1.1 });
  const neonR = ctx.ink({ color: '#000000', emissiveMap: sigilTexture(P.blood), emissive: P.blood, emissiveIntensity: 4, emissivePreset: 'neon', hatch: false, phase: 4.7 });
  const pools: { x: number; y: number; z: number; r: number }[] = [];

  // Tusk arch over the start gate: two giant curved tusks crossing above the road.
  for (const [a, b] of zoneRanges(ctx, 'gate').slice(0, 1)) {
    const t = a + (b - a) * 0.3;
    for (const side of [-1, 1]) {
      const p = besideExact(ctx, t, side * (HW + 3));
      const yaw = Math.atan2(besideExact(ctx, t, 0).x - p.x, besideExact(ctx, t, 0).z - p.z);
      const w = W(p.x, p.y, p.z, yaw);
      for (let k = 0; k < 6; k++) batch.part(w, cyl, bone, T(0, 2 + k * 2.6, k * k * 0.32, -k * 0.22, 0, 0, 1.4 - k * 0.18, 2.8, 1.4 - k * 0.18));
      batch.part(w, horn, bone, T(0, 17.5, 11, -1.5, 0, 0, 0.5, 3, 0.5));
      batch.part(w, box, rust, T(0, 1, 0, 0, 0, 0, 3.4, 2, 3.4));
      ctx.reserved.push({ x: p.x, z: p.z, r: 3 });
    }
  }

  // Neon signs with the clan sigil on scrap frames, facing the road (flickering).
  alongTrack(ctx, { step: 55, off: HW + 5, extra: 1, radius: 3 }, (p, yaw) => {
    if (heightLimit(ctx, p.x, p.z, 0) < 9) return;
    const w = W(p.x, p.y, p.z, yaw + rng.range(-0.25, 0.25));
    const tilt = rng.range(-0.12, 0.12);
    batch.part(w, box, rust, T(-2, 3, 0, 0, 0, tilt, 0.4, 6, 0.4));
    batch.part(w, box, rust, T(2, 3, 0, 0, 0, tilt, 0.4, 6, 0.4));
    batch.part(w, box, iron, T(0, 6, -0.1, 0, 0, tilt, 5, 5, 0.3));
    batch.part(w, box, rng.next() > 0.5 ? neonG : neonR, T(0, 6, 0.1, 0, 0, tilt, 4.4, 4.4, 0.04), false);
    batch.part(w, horn, bone, T(2.6, 8.8, 0, 0, 0, -0.6, 0.4, 2.4, 0.4));
  });

  // Cranes with magnets in the yard, arms swinging slowly.
  const cranes: { arm: Group; ph: number }[] = [];
  const cranesZone = zoneRanges(ctx, 'cranes');
  alongTrack(ctx, { step: 60, off: HW + 18, extra: 6, radius: 6, where: (t) => !inZones(cranesZone, t) }, (p, yaw0) => {
    if (heightLimit(ctx, p.x, p.z, 2) < 24) return;
    // The arm swings over the yard, away from the road.
    const yaw = yaw0 + Math.PI;
    const w = W(p.x, p.y, p.z, yaw);
    for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]] as const) batch.part(w, box, rust, T(x, 11, z, 0, 0, 0, 0.5, 22, 0.5));
    for (let y = 3; y < 22; y += 4) batch.part(w, box, iron, T(0, y, 0, 0, 0, 0, 3.6, 0.3, 3.6));
    const arm = new Group();
    const beam = new Mesh(box, rust);
    beam.scale.set(1, 1, 22);
    beam.position.set(0, 0, 7);
    arm.add(beam);
    const rope = new Mesh(box, iron);
    rope.scale.set(0.1, 8, 0.1);
    rope.position.set(0, -4, 16);
    arm.add(rope);
    const magnet = new Mesh(new CylinderGeometry(1.6, 1.6, 0.6, 12), iron);
    magnet.position.set(0, -8.2, 16);
    arm.add(magnet);
    arm.position.set(p.x, p.y + 22.5, p.z);
    arm.rotation.y = yaw;
    arm.traverse((o) => ((o as Mesh).isMesh ? ((o as Mesh).castShadow = true) : null));
    scene.add(arm);
    cranes.push({ arm, ph: rng.next() * 6 });
  });
  ctx.animate((_dt, time) => {
    for (const c of cranes) c.arm.rotation.y += Math.sin(time * 0.2 + c.ph) * 0.002;
  });

  // Furnaces with black smoke columns and fire light; dust devils on the open ground.
  const mouth = ctx.ink({ color: '#000000', emissive: '#FF7A2A', emissiveIntensity: 5, emissivePreset: 'fire', hatch: false });
  let lights = 0;
  alongTrack(ctx, { step: 90, off: HW + 11, extra: 3, radius: 3.5 }, (p, yaw) => {
    if (heightLimit(ctx, p.x, p.z, 3) < 13) return;
    const w = W(p.x, p.y, p.z, yaw);
    batch.part(w, cyl, rust, T(0, 3, 0, 0, 0, 0, 3, 6, 3));
    batch.part(w, box, mouth, T(0, 2, 2.9, 0, 0, 0, 2.2, 1.8, 0.3), false);
    batch.part(w, cyl, iron, T(0.8, 9, -0.6, 0, 0, 0, 0.9, 6, 0.9));
    const c = new Vector3(0.8, 12.5, -0.6).applyMatrix4(w);
    emitters.push({ kind: 'smoke', rate: 6, position: { x: c.x, y: c.y, z: c.z }, velocity: { x: 0, y: 4, z: 0 }, spread: 0.9, life: [5, 9], size: [3, 12] });
    const f = new Vector3(0, 1, 4).applyMatrix4(w);
    pools.push({ x: f.x, y: p.y, z: f.z, r: 7 });
    if (lights < 4) {
      const l = new PointLight('#FF7A2A', tunables.get('light.furnaceIntensity'), tunables.get('light.furnaceRange'), 2);
      l.position.set(f.x, p.y + 2.5, f.z);
      scene.add(l);
      localLights.push(l);
      lights++;
    }
  });
  for (let i = 0; i < 6; i++) {
    const p = besideExact(ctx, (i + 0.5) / 6, (i % 2 ? 1 : -1) * (HW + rng.range(14, 30)));
    emitters.push({ kind: 'dust', rate: 5, position: { x: p.x, y: p.y + 0.5, z: p.z }, velocity: { x: 1.5, y: 2.2, z: 0.5 }, spread: 2.2, life: [2, 3.5], size: [2, 6] });
  }

  // Orcs waving from the tops of wrecks and scrap stacks near the start.
  const skin = ['#4E6A2E', '#5E7A34', '#3E5A28'].map((c) => ctx.ink({ color: c }));
  const bodies = ['#5A3A22', '#3A2A1E', '#6A4A2A', '#2A2A2A'].map((c) => ctx.ink({ color: c, lineWeight: 0.5 }));
  for (const zone of ['gate', 'straight']) {
    for (const [a, b] of zoneRanges(ctx, zone)) {
      alongTrack(ctx, { step: 30, off: HW + 7, t0: a, t1: b, extra: 2, radius: 5 }, (p, yaw) => {
        const w = W(p.x, p.y, p.z, yaw + rng.range(-0.2, 0.2));
        batch.part(w, box, rust, T(0, 1.2, 0, 0, 0, rng.range(-0.1, 0.1), 9, 2.4, 3.6));
        batch.part(w, box, sheet, T(0, 2.7, -0.6, 0, 0, 0, 7, 0.6, 2.4));
        crowd(batch, w, 10, 8, 2, 2.4, bodies, rng.pick(skin), rng, 1.25);
        crowd(batch, w, 6, 6, 1.2, 3, bodies, rng.pick(skin), rng, 1.25);
      });
    }
  }

  // Crater rim: a ring of jagged red rock beyond the yard (the sky stays open).
  for (const q of ringAround(ctx, 90, 30)) {
    const y = heightAt(q.x, q.z);
    const h = 18 + rng.next() * 20;
    batch.add(cyl, rock, T(q.x, y + h / 2 - 2, q.z, rng.range(-0.1, 0.1), rng.range(0, 6), rng.range(-0.1, 0.1), 18 + rng.next() * 10, h, 14 + rng.next() * 8));
  }

  // Oil slick sheen on the oil piece: a couple of dark puddles beside the road too.
  const oil = ctx.ink({ color: '#1A1612', sheen: 1, lineWeight: 0 });
  for (const smp of track.samples) {
    if (smp.surface !== 'oil' || rng.next() > 0.03) continue;
    for (const s of [-1, 1]) {
      const x = smp.x - smp.tz * s * (HW + 2.5);
      const z = smp.z + smp.tx * s * (HW + 2.5);
      if (isFree(ctx, x, z, 1)) batch.add(cyl, oil, T(x, heightAt(x, z) + 0.04, z, 0, 0, 0, rng.range(1.5, 3), 0.04, rng.range(1, 2)), false);
    }
  }

  glowPools(scene, pools, '#FF7A2A', 0.22);
  batch.flush(scene);
}

/** The Warlord idol (landmark): a welded giant on a scrap tower, furnace in the chest. */
function warlordIdol(ctx: WorldContext, x: number, z: number, facing: number): void {
  const { tex, scene, localLights, emitters } = ctx;
  const g = new Group();
  const rust = ctx.ink({ map: tex.rust, mapping: 'world', mapScale: 0.25 });
  const iron = ctx.ink({ map: tex.iron, mapping: 'world', mapScale: 0.25, color: '#A89880' });
  const bone = ctx.ink({ color: P.bone });
  const fire = ctx.ink({ color: '#000000', emissive: '#FF6A1A', emissiveIntensity: 7, emissivePreset: 'fire', hatch: false, lineWeight: 0.4 });
  const eye = ctx.ink({ color: '#000000', emissive: P.toxic, emissiveIntensity: 5, emissivePreset: 'neon', hatch: false });
  const box = new BoxGeometry(1, 1, 1);
  const add = (geo: BufferGeometry, mat: InkLitMaterial, px: number, py: number, pz: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => {
    const m = new Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.scale.set(sx, sy, sz);
    m.rotation.set(rx, ry, rz);
    g.add(m);
    return m;
  };
  // Scrap tower base.
  add(box, rust, 0, 3, 0, 14, 6, 12, 0, 0.1, 0);
  add(box, iron, 1, 7.5, -1, 11, 3, 9, 0.05, -0.15, 0.04);
  // Legs, torso, shoulders.
  for (const s of [-1, 1]) add(box, iron, s * 2.4, 12, 0, 2.6, 6, 3);
  add(box, rust, 0, 19, 0, 9, 8, 5.5);
  add(box, iron, 0, 23.5, 0, 12, 2, 6);
  // Furnace in the chest.
  add(box, fire, 0, 19.5, 2.8, 4, 3.4, 0.4);
  add(box, iron, 0, 21.6, 2.9, 4.6, 0.6, 0.6);
  // Boiler on the back with a chimney.
  add(new CylinderGeometry(2.4, 2.4, 7, 12), iron, 0, 21, -4.4, 1, 1, 1, Math.PI / 2, 0, 0);
  add(new CylinderGeometry(0.7, 0.9, 6, 8), rust, 1.5, 27, -4.4);
  // Arms: one raised with a cleaver.
  add(box, rust, -7, 24, 0, 2.4, 2.4, 2.4);
  add(box, iron, -8.4, 28, 0, 2, 7, 2, 0, 0, 0.25);
  add(box, iron, -9.6, 33.5, 0, 1, 5, 6, 0, 0, 0.25);
  add(box, rust, 7, 22, 0, 2.4, 2.4, 2.4);
  add(box, iron, 7.6, 17.5, 0.6, 2, 7, 2, 0.15, 0, -0.1);
  // Head with tusks (one broken) and green eyes.
  add(box, iron, 0, 27, 0.4, 4.6, 4, 4.2);
  for (const s of [-1, 1]) add(box, eye, s * 1.1, 27.8, 2.55, 0.8, 0.5, 0.1);
  add(new CylinderGeometry(0, 0.6, 3.6, 7), bone, -1.4, 26.6, 2.8, 1, 1, 1, -0.6, 0, 0.25);
  add(new CylinderGeometry(0.35, 0.6, 1.4, 7), bone, 1.4, 25.4, 2.6, 1, 1, 1, -0.6, 0, -0.25);
  // Horns from the helmet.
  for (const s of [-1, 1]) add(new CylinderGeometry(0, 0.7, 5, 7), bone, s * 3, 30.5, 0, 1, 1, 1, 0, 0, -s * 0.8);
  const light = new PointLight('#FF6A1A', tunables.get('light.furnaceIntensity') * 1.6, 34, 2);
  light.position.set(0, 19.5, 6);
  g.add(light);
  localLights.push(light);
  ctx.place(g, x, z, facing);
  const pool = lightPool('#FF6A1A', 16, 0.2);
  pool.position.set(x, ctx.heightAt(x, z) + 0.08, z);
  scene.add(pool);
  const top = new Vector3(1.5, 30, -4.4).applyAxisAngle(new Vector3(0, 1, 0), facing);
  emitters.push({ kind: 'smoke', rate: 6, position: { x: x + top.x, y: ctx.heightAt(x, z) + top.y, z: z + top.z }, velocity: { x: 0, y: 4, z: 0 }, spread: 0.8, life: [5, 9], size: [3, 12] });
  emitters.push({ kind: 'ember', rate: 5, position: { x, y: ctx.heightAt(x, z) + 20, z }, velocity: { x: 0, y: 2, z: 0 }, spread: 1.4, life: [0.8, 1.8], size: [0.3, 0.1] });
}
