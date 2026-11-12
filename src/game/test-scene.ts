/**
 * M0 test scene: a foundry-coloured arena with landmarks to drive around.
 * Standard materials only; the ink-comic pipeline arrives in M1.
 */
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  PointLight,
  Scene,
} from 'three/webgpu';
import { Rng } from '../core/rng';

export const ARENA_RADIUS = 110;

/** Foundry palette subset (doc 02 §12). */
const P = {
  ink: '#1B1210',
  iron: '#5A514B',
  ironDark: '#3A3330',
  rust: '#7A4A2E',
  brass: '#B08A4A',
  dirt: '#5C4A3A',
  fog: '#3B3533',
  fire: '#FF8A2A',
  neonCyan: '#3FE0FF',
};

const mat = (color: string, extra: Partial<MeshStandardNodeMaterial> = {}) =>
  Object.assign(new MeshStandardNodeMaterial({ color, roughness: 0.85, metalness: 0.1 }), extra);

export function buildTestScene(seed: number): Scene {
  const scene = new Scene();
  scene.background = new Color(P.fog);
  scene.fog = new Fog(P.fog, 110, 320);

  scene.add(new HemisphereLight('#4A4440', '#2A1E1A', 1.2));
  const key = new DirectionalLight('#C9B8A6', 2.2);
  key.position.set(-40, 80, -30);
  scene.add(key);

  // Ground: dirt disc + riveted-plate "track" ring.
  const ground = new Mesh(new PlaneGeometry(400, 400), mat(P.dirt));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const rng = new Rng(seed);
  const plates = new Group();
  const plateGeo = new BoxGeometry(14, 0.2, 9);
  const plateMats = [mat(P.iron), mat(P.ironDark), mat(P.rust)];
  const ringR = 70;
  const segments = 48;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const m = new Mesh(plateGeo, rng.pick(plateMats));
    m.position.set(Math.sin(a) * ringR, 0.1, Math.cos(a) * ringR);
    m.rotation.y = a + Math.PI / 2;
    plates.add(m);
  }
  scene.add(plates);

  // Landmarks: pillars inside/outside the ring, furnaces with glow, neon sign boards.
  const pillarGeo = new CylinderGeometry(2, 2.4, 14, 10);
  const pillarMat = mat(P.ironDark, { metalness: 0.4 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rng.range(-0.05, 0.05);
    for (const r of [ringR - 16, ringR + 16]) {
      const p = new Mesh(pillarGeo, pillarMat);
      p.position.set(Math.sin(a) * r, 7, Math.cos(a) * r);
      scene.add(p);
    }
  }

  const furnaceMat = mat(P.rust);
  const glowMat = mat('#000000', { emissive: new Color(P.fire), emissiveIntensity: 3 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const g = new Group();
    const body = new Mesh(new BoxGeometry(8, 9, 8), furnaceMat);
    body.position.y = 4.5;
    const mouth = new Mesh(new PlaneGeometry(4, 3), glowMat);
    mouth.position.set(0, 3, 4.01);
    const light = new PointLight(P.fire, 400, 30, 2);
    light.position.set(0, 3, 6);
    g.add(body, mouth, light);
    g.position.set(Math.sin(a) * (ringR + 30), 0, Math.cos(a) * (ringR + 30));
    g.lookAt(0, 0, 0);
    scene.add(g);
  }

  const neonMat = mat('#000000', { emissive: new Color(P.neonCyan), emissiveIntensity: 2.5, side: DoubleSide });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const sign = new Mesh(new PlaneGeometry(10, 4), neonMat);
    sign.position.set(Math.sin(a) * (ringR - 30), 6, Math.cos(a) * (ringR - 30));
    sign.lookAt(0, 6, 0);
    scene.add(sign);
  }

  return scene;
}

/** Placeholder racer: hull, smokestack, wheels and an identity banner (doc 02 §13.1). */
export function buildTestVehicle(identityColor: string): Group {
  const g = new Group();
  const hull = new Mesh(new BoxGeometry(2.6, 1.4, 4.4), mat(P.iron, { metalness: 0.5, roughness: 0.6 }));
  hull.position.y = 1.2;
  const cab = new Mesh(new BoxGeometry(2.0, 1.0, 1.8), mat(P.rust));
  cab.position.set(0, 2.3, -0.6);
  const stack = new Mesh(new CylinderGeometry(0.3, 0.35, 1.6, 8), mat(P.brass, { metalness: 0.7, roughness: 0.4 }));
  stack.position.set(0.7, 2.8, 1.2);
  g.add(hull, cab, stack);

  const wheelGeo = new CylinderGeometry(0.7, 0.7, 0.5, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = mat(P.ink);
  for (const [x, z] of [[-1.45, 1.4], [1.45, 1.4], [-1.45, -1.4], [1.45, -1.4]] as const) {
    const w = new Mesh(wheelGeo, wheelMat);
    w.position.set(x, 0.7, z);
    w.name = 'wheel';
    g.add(w);
  }

  const pole = new Mesh(new CylinderGeometry(0.05, 0.05, 2.4, 6), mat(P.ink));
  pole.position.set(-0.9, 3.0, -1.6);
  const banner = new Mesh(
    new PlaneGeometry(0.9, 1.1),
    mat(identityColor, { emissive: new Color(identityColor), emissiveIntensity: 0.6, side: DoubleSide }),
  );
  banner.position.set(-0.9, 3.6, -2.1);
  banner.rotation.y = Math.PI / 2;
  banner.name = 'banner';
  g.add(pole, banner);
  return g;
}
