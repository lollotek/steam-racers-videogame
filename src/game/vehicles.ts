/**
 * Look-test placeholder vehicles (doc 01 §1.2): chunky, readable silhouettes built from primitives,
 * with identity banners and runes (doc 02 §13.1). Real GLB models replace these later.
 */
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  type BufferGeometry,
  type Texture,
} from 'three/webgpu';
import { InkLitMaterial, type InkParams } from '../render/ink/ink-material';
import type { ProceduralSet } from '../render/procedural/textures';

export interface VehicleRig {
  root: Group;
  /** Smoke emitter sockets (doc 03 §6.3 `stack_*`). */
  stacks: Object3D[];
  /** Wheels that spin around local X. */
  wheels: Object3D[];
  banner: Mesh;
}

const FLAG_VEHICLE = 1;

/** Vehicles are the brightest values on screen (doc 02 §13 value hierarchy): albedo boosted ×1.6. */
const VEHICLE_BOOST = new Color(1.6, 1.55, 1.5);

function vMat(p: InkParams): InkLitMaterial {
  const color = p.color !== undefined ? new Color(p.color).multiply(VEHICLE_BOOST) : VEHICLE_BOOST;
  return new InkLitMaterial({ mapping: 'object', hatchSpace: 'object', lineWeight: 1, flags: FLAG_VEHICLE, mapScale: 0.5, ...p, color });
}

function add(parent: Object3D, geo: BufferGeometry, mat: InkLitMaterial, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): Mesh {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function bannerOn(root: Object3D, tex: Texture, color: string, x: number, y: number, z: number, mats: { ink: InkLitMaterial }): Mesh {
  add(root, new CylinderGeometry(0.06, 0.06, 2.6, 6), mats.ink, x, y, z);
  const cloth = new InkLitMaterial({ map: tex, color, mapping: 'uv', lineWeight: 1, hatchSpace: 'object', flags: FLAG_VEHICLE });
  cloth.side = DoubleSide;
  const b = add(root, new PlaneGeometry(1.0, 1.25, 4, 4), cloth, x, y + 0.55, z - 0.55, 0, Math.PI / 2, 0);
  b.name = 'banner';
  return b;
}

function rune(root: Object3D, color: string, x: number, y: number, z: number, w: number, h: number, ry = 0): void {
  const m = new InkLitMaterial({ color: '#000000', emissive: color, emissiveIntensity: 3, emissivePreset: 'rune', hatch: false, lineWeight: 0.5 });
  add(root, new BoxGeometry(w, h, 0.06), m, x, y, z, 0, ry, 0);
}

/** Heavy steam tank with tracks, turret, boiler and dozer blade (refs/vehicles 3, 5). */
export function buildSteamTank(tex: ProceduralSet, identity: string): VehicleRig {
  const root = new Group();
  const rust = vMat({ map: tex.rust });
  const iron = vMat({ map: tex.iron });
  const brass = vMat({ map: tex.brass, sheen: 0.8, mapScale: 1 });
  const ink = vMat({ color: '#2A201C' });
  const wheels: Object3D[] = [];

  // Tracks.
  for (const sx of [-1.45, 1.45]) {
    add(root, new BoxGeometry(0.9, 1.15, 5.6), ink, sx, 0.62, 0);
    for (let k = 0; k < 5; k++) {
      const w = add(root, new CylinderGeometry(0.42, 0.42, 0.95, 12), iron, sx, 0.55, -2.1 + k * 1.05, 0, 0, Math.PI / 2);
      wheels.push(w);
    }
  }
  // Hull + cab.
  add(root, new BoxGeometry(2.4, 1.3, 5.0), rust, 0, 1.6, 0);
  add(root, new BoxGeometry(2.0, 1.0, 2.0), iron, 0, 2.7, -0.2);
  // Boiler at the back, brass bands.
  add(root, new CylinderGeometry(0.85, 0.85, 2.2, 14), iron, 0, 2.1, -2.0, Math.PI / 2, 0, 0);
  for (const z of [-1.3, -2.6]) add(root, new CylinderGeometry(0.9, 0.9, 0.18, 14), brass, 0, 2.1, z, Math.PI / 2, 0, 0);
  // Turret + cannon.
  add(root, new CylinderGeometry(0.9, 1.0, 0.7, 12), rust, 0, 3.55, 0.2);
  add(root, new CylinderGeometry(0.22, 0.26, 3.2, 10), brass, 0, 3.6, 1.9, Math.PI / 2, 0, 0);
  // Smokestack (emitter socket at the top).
  add(root, new CylinderGeometry(0.28, 0.36, 1.8, 10), brass, 0.65, 3.4, -2.3);
  const stack = new Object3D();
  stack.position.set(0.65, 4.4, -2.3);
  root.add(stack);
  // Dozer blade.
  add(root, new BoxGeometry(3.6, 1.3, 0.3), iron, 0, 0.9, 3.2, -0.25, 0, 0);
  add(root, new BoxGeometry(0.25, 0.25, 1.2), ink, -1.0, 1.1, 2.6);
  add(root, new BoxGeometry(0.25, 0.25, 1.2), ink, 1.0, 1.1, 2.6);
  // Identity: runes on both flanks + banner.
  rune(root, identity, 1.23, 1.7, 0.4, 1.6, 0.22, Math.PI / 2);
  rune(root, identity, -1.23, 1.7, 0.4, 1.6, 0.22, Math.PI / 2);
  const banner = bannerOn(root, tex.banner, identity, -0.9, 3.6, -1.4, { ink });
  return { root, stacks: [stack], wheels, banner };
}

/** Spiked hot rod with oversized rear wheels and exhaust stacks (refs/engine 1–3). */
export function buildHotRod(tex: ProceduralSet, identity: string): VehicleRig {
  const root = new Group();
  const paint = vMat({ map: tex.rust, color: '#C9B8A6' });
  const iron = vMat({ map: tex.iron });
  const brass = vMat({ map: tex.brass, sheen: 0.8, mapScale: 1 });
  const ink = vMat({ color: '#2A201C' });
  const spikeMat = vMat({ color: '#8C8078', sheen: 0.5 });
  const wheels: Object3D[] = [];

  add(root, new BoxGeometry(2.0, 0.7, 5.0), iron, 0, 0.95, 0); // chassis
  add(root, new BoxGeometry(1.8, 1.1, 1.8), paint, 0, 1.75, -0.8); // cab
  add(root, new BoxGeometry(1.5, 0.9, 1.9), paint, 0, 1.55, 1.3); // engine hood
  add(root, new BoxGeometry(1.1, 0.7, 1.2), brass, 0, 2.25, 1.3); // blower
  for (const sx of [-0.95, 0.95])
    for (const z of [0.7, 1.2, 1.7]) add(root, new CylinderGeometry(0.11, 0.13, 0.9, 8), brass, sx, 2.1, z, 0, 0, sx * 0.6);
  const stacks: Object3D[] = [];
  for (const sx of [-0.4, 0.4]) {
    add(root, new CylinderGeometry(0.16, 0.2, 1.4, 8), ink, sx, 2.6, -1.9);
    const s = new Object3D();
    s.position.set(sx, 3.35, -1.9);
    root.add(s);
    stacks.push(s);
  }
  const tyre = new CylinderGeometry(1.05, 1.05, 0.9, 16);
  const tyreFront = new CylinderGeometry(0.62, 0.62, 0.55, 14);
  const spike = new ConeGeometry(0.12, 0.45, 6);
  for (const sx of [-1.45, 1.45]) {
    const w = add(root, tyre, ink, sx, 1.05, -1.6, 0, 0, Math.PI / 2);
    wheels.push(w);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const s = new Mesh(spike, spikeMat);
      s.position.set(Math.cos(a) * 1.15, 0, Math.sin(a) * 1.15);
      s.rotation.set(0, 0, -Math.PI / 2 + 0);
      s.lookAt(Math.cos(a) * 3, 0, Math.sin(a) * 3);
      s.rotateX(Math.PI / 2);
      w.add(s);
    }
    wheels.push(add(root, tyreFront, ink, sx * 0.85, 0.62, 1.9, 0, 0, Math.PI / 2));
  }
  // Ram with spikes.
  add(root, new BoxGeometry(2.2, 0.5, 0.35), iron, 0, 0.8, 2.65);
  for (let k = -2; k <= 2; k++) add(root, spike, spikeMat, k * 0.45, 0.8, 3.0, Math.PI / 2, 0, 0);
  add(root, new SphereGeometry(0.22, 10, 8), vMat({ color: '#000', emissive: '#FFD27A', emissiveIntensity: 4, hatch: false }), 0.6, 1.3, 2.3);
  add(root, new SphereGeometry(0.22, 10, 8), vMat({ color: '#000', emissive: '#FFD27A', emissiveIntensity: 4, hatch: false }), -0.6, 1.3, 2.3);
  rune(root, identity, 0.91, 1.75, -0.8, 1.2, 0.2, Math.PI / 2);
  rune(root, identity, -0.91, 1.75, -0.8, 1.2, 0.2, Math.PI / 2);
  const banner = bannerOn(root, tex.banner, identity, -0.7, 2.9, -1.2, { ink });
  return { root, stacks, wheels, banner };
}
