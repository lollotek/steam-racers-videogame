/**
 * Iron City foundry (doc 01 D6, doc 02 §12): the M1 look-test world, now a biome definition.
 * The tunable defaults are the foundry values, so `tunables` is empty; the set pieces below are
 * the M1 ones, unchanged (furnaces, steam vents, overhead pipes, signs, casings, catwalk, molten
 * pool, hall walls).
 */
import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Mesh,
  Object3D,
  PlaneGeometry,
  PointLight,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
} from 'three/webgpu';
import { tunables } from '../core/tunables';
import type { InkLitMaterial } from '../render/ink/ink-material';
import type { BiomeDef, WorldContext } from '../world/biome';
import { lavaMaterial, lightPool, neonTexture, textTexture } from '../world/kit';

export const FOUNDRY: BiomeDef = {
  id: 'foundry',
  name: 'Iron City Foundry',
  tunables: {},
  ground: { tex: 'dirt', tint: '#C8B4A4', scale: 1 / 10 },
  gantry: { lines: ['START'], bg: '#B08A4A', fg: '#1B1210' },
  pit: 'lava',
  decorate,
};

function decorate(ctx: WorldContext): void {
  const { scene, track, curve, tex, rng, reserved, emitters, localLights, beside, place, distToTrack, ink, heightAt } = ctx;
  const HW = track.halfWidth;
  const up = new Vector3(0, 1, 0);
  const rustMat = ink({ map: tex.rust, mapping: 'world', mapScale: 0.25 });
  const ironMat = ink({ map: tex.iron, mapping: 'world', mapScale: 0.25 });
  const brassMat = ink({ map: tex.brass, mapping: 'world', mapScale: 0.5, sheen: 0.8 });
  const fireMat = ink({ color: '#000000', emissive: '#FF8A2A', emissiveIntensity: 5, emissivePreset: 'fire', hatch: false, lineWeight: 0.5 });
  const mesh = (geo: BufferGeometry, mat: InkLitMaterial, x: number, y: number, z: number, rx = 0, rz = 0) => {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, 0, rz);
    return m;
  };

  // Furnaces / boilers with glowing mouths, chimneys and light pools.
  const furnaceTs = [0.04, 0.2, 0.37, 0.55, 0.72, 0.88];
  furnaceTs.forEach((t, i) => {
    const side = i % 2 === 0 ? 1 : -1;
    const spot = beside(t, side * (HW + 13), 2);
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
    g.lookAt(curve.getPointAt(t).x, p.y, curve.getPointAt(t).z);
    const pool = lightPool('#FF8A2A', 14);
    const worldLight = new Vector3();
    g.updateMatrixWorld(true);
    light.getWorldPosition(worldLight);
    pool.position.x = worldLight.x;
    pool.position.y = heightAt(worldLight.x, worldLight.z) + 0.06;
    pool.position.z = worldLight.z;
    scene.add(pool);
    const chimneyTop = new Vector3(1.5, 21, -1.0).applyMatrix4(g.matrixWorld.compose(g.position, g.quaternion, g.scale));
    emitters.push({ kind: 'smoke', rate: 5, position: { x: chimneyTop.x, y: chimneyTop.y, z: chimneyTop.z }, velocity: { x: 0, y: 3, z: 0 }, spread: 0.8, life: [3.5, 6], size: [3, 9] });
  });

  // Steam vents beside the track.
  for (let i = 0; i < 9; i++) {
    const t = (i + 0.5) / 9;
    const side = rng.next() > 0.5 ? 1 : -1;
    const spot = beside(t, side * (HW + 2.5));
    if (!spot) continue;
    const { p } = spot;
    const vent = new Group();
    vent.add(mesh(new CylinderGeometry(0.7, 0.9, 1.2, 10), brassMat, 0, 0.6, 0));
    vent.add(mesh(new CylinderGeometry(0.35, 0.35, 3, 8), ironMat, 1.2, 1.5, 0, 0, Math.PI / 2));
    place(vent, p.x, p.z, rng.next() * 6);
    reserved.push({ x: p.x, z: p.z, r: 2.5 });
    emitters.push({ kind: 'steam', rate: 7, position: { x: p.x, y: p.y + 1.3, z: p.z }, velocity: { x: 0, y: 3.2, z: 0 }, spread: 0.9, life: [1.8, 3.2], size: [1.2, 5.5] });
  }

  // Overhead pipe runs with supports.
  for (const [t, side] of [[0.12, 1], [0.3, -1], [0.62, 1], [0.8, -1]] as const) {
    const sa = beside(t, side * (HW + 6), 1);
    const sb = beside(t + 0.05, side * (HW + 6), 1);
    if (!sa || !sb || Math.sign(sa.p.distanceTo(curve.getPointAt(t)) - 1) !== Math.sign(sb.p.distanceTo(curve.getPointAt(t + 0.05)) - 1)) continue;
    const a = sa.p;
    const b = sb.p;
    // The pipe must not cross the road between its supports.
    if (distToTrack((a.x + b.x) / 2, (a.z + b.z) / 2) < HW + 2) continue;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const yTop = Math.max(a.y, b.y) + 4.5;
    const pipe = new Mesh(new CylinderGeometry(0.8, 0.8, len, 12), rustMat);
    pipe.position.set((a.x + b.x) / 2, yTop, (a.z + b.z) / 2);
    pipe.quaternion.setFromUnitVectors(up, new Vector3(b.x - a.x, 0, b.z - a.z).normalize());
    scene.add(pipe);
    for (let k = 0; k <= 4; k++) reserved.push({ x: a.x + ((b.x - a.x) * k) / 4, z: a.z + ((b.z - a.z) * k) / 4, r: 2 });
    for (const q of [a, b]) {
      const h = yTop - q.y;
      const s = mesh(new BoxGeometry(0.5, h, 0.5), ironMat, q.x, q.y + h / 2, q.z);
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
    const spot = beside(t as number, (side as number) * (HW + 4.5), 4);
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
    g.lookAt(c.x, p.y, c.z);
  });

  // Shell casings scattered on the track (instanced).
  const casingGeo = new CylinderGeometry(0.06, 0.06, 0.3, 6);
  casingGeo.rotateZ(Math.PI / 2);
  const casings = new InstancedMesh(casingGeo, ink({ color: '#C8A050', sheen: 1, hatch: false, lineWeight: 0 }), 500);
  const dummy = new Object3D();
  let placed = 0;
  for (let i = 0; i < 500; i++) {
    const t = rng.next();
    const lat = rng.range(-HW, HW) * 0.95;
    const { p } = beside(t, lat)!;
    // On the road: road height (none over jump gaps).
    const smp = track.samples[Math.min(track.samples.length - 1, Math.floor(t * track.samples.length))]!;
    if (smp.feature === 'gap') continue;
    dummy.position.set(p.x, smp.y + 0.12, p.z);
    dummy.rotation.set(0, rng.next() * 6.28, 0);
    dummy.updateMatrix();
    casings.setMatrixAt(placed++, dummy.matrix);
  }
  casings.count = placed;
  scene.add(casings);

  // Spectator catwalk with simple figures (refs/engine 4–6).
  (() => {
    const t = 0.5;
    const spot = beside(t, -(HW + 9), 6);
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
    g.lookAt(c.x, p.y, c.z);
  })();

  // Molten-metal pool with a stone rim, steam and a warm light (doc 02 §10).
  (() => {
    const spot = beside(0.64, -(HW + 17), 3);
    if (!spot) return;
    const { p } = spot;
    const pool = new Mesh(new CircleGeometry(7, 40), lavaMaterial(tex.noise));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(p.x, p.y + 0.12, p.z);
    scene.add(pool);
    const rim = new Mesh(new TorusGeometry(7.2, 0.8, 8, 40), ink({ map: tex.iron, mapping: 'world', mapScale: 0.3, color: '#9A8A80' }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(p.x, p.y + 0.3, p.z);
    rim.receiveShadow = true;
    scene.add(rim);
    const light = new PointLight('#FF6A1A', tunables.get('light.furnaceIntensity'), tunables.get('light.furnaceRange'), 2);
    light.position.set(p.x, p.y + 3, p.z);
    scene.add(light);
    localLights.push(light);
    reserved.push({ x: p.x, z: p.z, r: 10 });
    for (let k = 0; k < 3; k++)
      emitters.push({ kind: 'steam', rate: 3, position: { x: p.x + rng.range(-4, 4), y: p.y + 0.5, z: p.z + rng.range(-4, 4) }, velocity: { x: 0, y: 1.8, z: 0 }, spread: 0.8, life: [2.5, 4], size: [2, 6] });
  })();

  // Foundry hall: perimeter walls and girders to close the view (fog hides the rest).
  const hallMat = ink({ map: tex.iron, mapping: 'world', mapScale: 0.08 });
  const cx = (track.bounds.minX + track.bounds.maxX) / 2;
  const cz = (track.bounds.minZ + track.bounds.maxZ) / 2;
  const hallR = Math.max(190, Math.hypot(track.bounds.maxX - track.bounds.minX, track.bounds.maxZ - track.bounds.minZ) / 2 + 90);
  // The M1 hall is centred on the origin; bigger tracks get a bigger hall around their centre.
  const ox = hallR > 190 ? cx : 0;
  const oz = hallR > 190 ? cz : 0;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const r = hallR;
    const w = mesh(new BoxGeometry((70 * r) / 190, 40, 6), hallMat, ox + Math.cos(a) * r, track.bounds.minY + 20, oz + Math.sin(a) * r);
    w.rotation.y = -a + Math.PI / 2;
    scene.add(w);
    const pillar = mesh(new BoxGeometry(5, 46, 5), rustMat, ox + Math.cos(a + 0.17) * (r - 6), track.bounds.minY + 23, oz + Math.sin(a + 0.17) * (r - 6));
    scene.add(pillar);
  }
}
