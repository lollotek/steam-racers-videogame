/**
 * Visuals of the track features (doc 04 §3 A3/A4): crates on the road and the generic skins of
 * the four hazard kinds. Placeholders built from primitives; the Cup worlds (phase C) replace
 * the skins. Reads RaceSim state only, never writes it.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
  type Scene,
} from 'three/webgpu';
import type { ProceduralSet } from '../render/procedural/textures';
import type { ParticleSystem, Emitter } from '../render/fx/particles';
import type { SparkSystem } from '../render/fx/sparks';
import type { RaceSim } from '../sim/race-sim';
import { type CompiledHazard, hazardClock } from '../track/hazards';
import { ink } from '../world/kit';

const glow = (color: string, opacity = 0.6) => {
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, color: new Color(color) });
  m.opacity = opacity;
  (m as unknown as { fog: boolean }).fog = false;
  return m;
};

interface PickupView {
  root: Group;
  ring: Mesh;
  baseY: number;
}

interface HazardView {
  h: CompiledHazard;
  update(phase: 'idle' | 'warning' | 'active', t: number, duration: number, time: number): void;
}

export class FeatureViews {
  private pickups: PickupView[] = [];
  private hazards: HazardView[] = [];
  private time = 0;
  private tmp = new Vector3();

  constructor(
    scene: Scene,
    public sim: RaceSim,
    tex: ProceduralSet,
    private readonly particles: ParticleSystem,
    private readonly sparks: SparkSystem,
  ) {
    const track = sim.track;
    // --- Crates: coal (ember glow) and money bags (brass), with a reserved glow ring (doc 04 §4).
    const crateGeo = new BoxGeometry(1.3, 1.3, 1.3);
    const coalMat = ink({ map: tex.iron, mapping: 'object', mapScale: 1, color: '#5A4A40', emissive: '#FF6A1A', emissiveIntensity: 0.8, emissivePreset: 'fire' });
    const bagGeo = new SphereGeometry(0.75, 12, 8);
    bagGeo.scale(1, 1.15, 1);
    const bagMat = ink({ map: tex.brass, mapping: 'object', mapScale: 1, color: '#E8C878', sheen: 1 });
    const knotGeo = new CylinderGeometry(0.18, 0.3, 0.5, 8);
    const ringGeo = new CircleGeometry(2, 24);
    ringGeo.rotateX(-Math.PI / 2);
    for (const p of track.pickups) {
      const root = new Group();
      if (p.kind === 'coal') {
        const c = new Mesh(crateGeo, coalMat);
        c.castShadow = true;
        root.add(c);
      } else {
        const b = new Mesh(bagGeo, bagMat);
        b.castShadow = true;
        root.add(b);
        const k = new Mesh(knotGeo, bagMat);
        k.position.y = 0.95;
        root.add(k);
      }
      const baseY = p.y + 1.3;
      root.position.set(p.x, baseY, p.z);
      scene.add(root);
      const ring = new Mesh(ringGeo, glow(p.kind === 'coal' ? '#FFD8A0' : '#FFF0C0', 0.35));
      ring.position.set(p.x, p.y + 0.08, p.z);
      ring.renderOrder = 5;
      scene.add(ring);
      this.pickups.push({ root, ring, baseY });
    }

    // --- Hazards ---------------------------------------------------------------------
    for (const h of track.hazards) {
      const g = new Group();
      g.position.set(h.x, h.y, h.z);
      g.rotation.y = h.heading;
      scene.add(g);
      if (h.kind === 'vent') this.hazards.push(this.vent(g, h, tex));
      else if (h.kind === 'crossing') this.hazards.push(this.crossing(g, h, tex));
      else if (h.kind === 'crane') this.hazards.push(this.crane(g, h, tex));
      else this.hazards.push(this.stream(g, h));
    }
  }

  /** Forge vents: a grate across the road, glowing in the warning, fire jets when active. */
  private vent(g: Group, h: CompiledHazard, tex: ProceduralSet): HazardView {
    const grate = new Mesh(new PlaneGeometry(h.width, h.length), ink({ map: tex.grate, mapping: 'uv', mapScale: 2, lineWeight: 0.5 }));
    grate.rotation.x = -Math.PI / 2;
    grate.position.y = 0.08;
    g.add(grate);
    const heat = new Mesh(new PlaneGeometry(h.width, h.length), glow('#FF7A2A', 0));
    heat.rotation.x = -Math.PI / 2;
    heat.position.y = 0.12;
    heat.renderOrder = 6;
    g.add(heat);
    const jets: Emitter[] = [];
    const n = Math.max(2, Math.round(h.width / 3));
    for (let k = 0; k < n; k++) {
      const lat = -h.width / 2 + ((k + 0.5) / n) * h.width;
      const x = h.x + -Math.cos(h.heading) * lat;
      const z = h.z + Math.sin(h.heading) * lat;
      jets.push(this.particles.addEmitter({ kind: 'smoke', rate: 0, position: { x, y: h.y + 0.3, z }, velocity: { x: 0, y: 9, z: 0 }, spread: 0.5, life: [0.4, 0.8], size: [1.2, 3] }));
    }
    let sparkAcc = 0;
    return {
      h,
      update: (phase, t, duration, time) => {
        const m = heat.material as MeshBasicNodeMaterial;
        m.opacity = phase === 'warning' ? 0.25 + 0.35 * (t / Math.max(0.01, duration)) * (0.7 + 0.3 * Math.sin(time * 20)) : phase === 'active' ? 0.9 : 0.05;
        for (const j of jets) j.rate = phase === 'active' ? 40 : 0;
        if (phase === 'active') {
          sparkAcc += 1;
          if (sparkAcc % 3 === 0) for (const j of jets) this.sparks.burst(j.position.x, h.y + 1 + Math.random() * 3, j.position.z, 0, 0, 0, 0, 2, 0.9);
        }
      },
    };
  }

  /** Level crossing: barrier arms drop in the warning (red lamps blink), a train crosses when active. */
  private crossing(g: Group, h: CompiledHazard, tex: ProceduralSet): HazardView {
    const half = h.width / 2;
    const railMat = ink({ color: '#8A8480', sheen: 0.6 });
    for (const dz of [-1.2, 1.2]) {
      const rail = new Mesh(new BoxGeometry(h.width + 60, 0.15, 0.18), railMat);
      rail.position.set(0, 0.08, dz);
      g.add(rail);
    }
    const postMat = ink({ color: '#2A2422' });
    const armMat = ink({ color: '#D8D2C8', emissive: '#D94848', emissiveIntensity: 0.4 });
    const lampOn = glow('#FF3030', 0);
    const arms: Group[] = [];
    for (const side of [-1, 1]) {
      const post = new Mesh(new BoxGeometry(0.4, 2.4, 0.4), postMat);
      // Driver's right is local -x (heading rotation of the group).
      post.position.set(-side * (half + 1.2), 1.2, -side * (h.length / 2 + 0.5));
      g.add(post);
      const lamp = new Mesh(new SphereGeometry(0.35, 8, 6), lampOn);
      lamp.position.set(post.position.x, 2.7, post.position.z);
      g.add(lamp);
      const pivot = new Group();
      pivot.position.set(post.position.x, 1.6, post.position.z);
      const arm = new Mesh(new BoxGeometry(h.width * 0.55, 0.25, 0.25), armMat);
      arm.position.x = side * (h.width * 0.275);
      pivot.add(arm);
      g.add(pivot);
      arms.push(pivot);
    }
    // Train: locomotive + two wagons, moving along local x across the road.
    const train = new Group();
    const loco = new Mesh(new BoxGeometry(10, 4, 3), ink({ map: tex.iron, mapping: 'world', mapScale: 0.3 }));
    loco.position.y = 2.4;
    train.add(loco);
    const stack = new Mesh(new CylinderGeometry(0.5, 0.6, 2, 8), ink({ map: tex.rust, mapping: 'world', mapScale: 0.3 }));
    stack.position.set(3.5, 5.2, 0);
    train.add(stack);
    for (const k of [1, 2]) {
      const w = new Mesh(new BoxGeometry(9, 3.4, 2.8), ink({ map: tex.rust, mapping: 'world', mapScale: 0.3 }));
      w.position.set(-k * 10, 2.1, 0);
      train.add(w);
    }
    train.traverse((o) => ((o as Mesh).isMesh ? ((o as Mesh).castShadow = true) : null));
    train.visible = false;
    g.add(train);
    const smoke = this.particles.addEmitter({ kind: 'smoke', rate: 0, position: { x: h.x, y: h.y + 6, z: h.z }, velocity: { x: 0, y: 4, z: 0 }, spread: 0.8, life: [1.5, 3], size: [2, 6] });
    return {
      h,
      update: (phase, t, duration, time) => {
        const down = phase === 'idle' ? 0 : phase === 'warning' ? Math.min(1, t / 1) : 1;
        arms.forEach((a, i) => (a.rotation.z = (i === 0 ? 1 : -1) * (1 - down) * 1.3));
        lampOn.opacity = phase === 'idle' ? 0 : Math.sin(time * 8) > 0 ? 0.9 : 0.1;
        train.visible = phase === 'active';
        if (phase === 'active') {
          const u = t / Math.max(0.01, duration);
          const x = -40 + u * 110; // enters from the right of the road, leaves on the left
          train.position.set(-x, 0, 0);
          train.updateMatrixWorld();
          stack.getWorldPosition(this.tmp);
          smoke.position.x = this.tmp.x;
          smoke.position.y = this.tmp.y + 1;
          smoke.position.z = this.tmp.z;
          smoke.rate = 30;
        } else smoke.rate = 0;
      },
    };
  }

  /** Magnet crane: a scrap block drops on the marked lanes and stays there as a wall. */
  private crane(g: Group, h: CompiledHazard, tex: ProceduralSet): HazardView {
    const iron = ink({ map: tex.rust, mapping: 'world', mapScale: 0.3 });
    // Tower beside the road on the side away from the zone. Local frame: +z along the track,
    // the driver's right is local −x; the group sits at the zone centre.
    const towerLat = (h.latC <= 0 ? 1 : -1) * (this.sim.track.halfWidth + 6);
    const towerLocalX = -(towerLat - h.latC);
    const tower = new Mesh(new BoxGeometry(2, 18, 2), iron);
    tower.position.set(towerLocalX, 9, 0);
    g.add(tower);
    const arm = new Mesh(new BoxGeometry(Math.abs(towerLocalX) + 2, 1, 1), iron);
    arm.position.set(towerLocalX / 2, 18, 0);
    g.add(arm);
    const block = new Mesh(new BoxGeometry(h.width, 5, h.length), ink({ map: tex.iron, mapping: 'world', mapScale: 0.4, color: '#B0A090' }));
    block.castShadow = true;
    g.add(block);
    const magnet = new Mesh(new CylinderGeometry(1.6, 1.6, 0.6, 12), ink({ color: '#3A3330', sheen: 0.6 }));
    g.add(magnet);
    const rope = new Mesh(new BoxGeometry(0.1, 1, 0.1), ink({ color: '#2A2422' }));
    g.add(rope);
    // The block's shadow on the road: a dark plane growing more opaque before the drop.
    const shadowMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, color: new Color('#120C0A') });
    shadowMat.opacity = 0;
    const shadow = new Mesh(new PlaneGeometry(h.width, h.length), shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.1;
    shadow.renderOrder = 6;
    g.add(shadow);
    let landed = false;
    return {
      h,
      update: (phase, t, duration) => {
        const high = 13;
        let y = high;
        if (phase === 'warning') y = high - (high - 6) * Math.min(1, t / Math.max(0.01, duration));
        if (phase === 'active') {
          const drop = Math.min(1, t / 0.25);
          y = 6 - 3.5 * drop * drop;
          if (drop >= 1 && !landed) {
            landed = true;
            this.particles.burst({ kind: 'dust', rate: 0, position: { x: h.x, y: h.y + 0.5, z: h.z }, velocity: { x: 0, y: 3, z: 0 }, spread: 4, life: [0.8, 1.8], size: [2, 6] }, 24);
            this.sparks.burst(h.x, h.y + 0.5, h.z, 0, 0, 0, 0, 30, 1.2);
          }
        } else landed = false;
        block.position.set(0, y, 0);
        magnet.position.set(0, y + 2.8, 0);
        rope.scale.y = Math.max(0.1, 18 - (y + 3));
        rope.position.set(0, (18 + y + 3) / 2, 0);
        shadowMat.opacity = phase === 'idle' ? 0.1 : phase === 'warning' ? 0.2 + 0.4 * (t / Math.max(0.01, duration)) : 0.6;
      },
    };
  }

  /** Sap streams: glowing lanes along the road, bright on the pulse, dim (and slippery) between. */
  private stream(g: Group, h: CompiledHazard): HazardView {
    // A ribbon in the group's local frame (straight approximation along the track tangent).
    const lane = new Mesh(new PlaneGeometry(h.width, h.length), glow('#3FF0E0', 0.2));
    lane.rotation.x = -Math.PI / 2;
    lane.position.y = 0.1;
    lane.renderOrder = 6;
    g.add(lane);
    const core = new Mesh(new PlaneGeometry(h.width * 0.3, h.length), glow('#B8FFF4', 0.15));
    core.rotation.x = -Math.PI / 2;
    core.position.y = 0.11;
    core.renderOrder = 6;
    g.add(core);
    return {
      h,
      update: (phase, t, duration, time) => {
        const pulse = phase === 'active' ? Math.sin((t / Math.max(0.01, duration)) * Math.PI) : 0;
        (lane.material as MeshBasicNodeMaterial).opacity = 0.12 + 0.5 * pulse + 0.03 * Math.sin(time * 3);
        (core.material as MeshBasicNodeMaterial).opacity = 0.1 + 0.7 * pulse;
      },
    };
  }

  update(dt: number): void {
    this.time += dt;
    const sim = this.sim;
    sim.features.pickups.forEach((st, i) => {
      const v = this.pickups[i]!;
      v.root.visible = st.active;
      (v.ring.material as MeshBasicNodeMaterial).opacity = st.active ? 0.3 + 0.1 * Math.sin(this.time * 4 + i) : 0;
      v.root.position.y = v.baseY + Math.sin(this.time * 2.5 + i) * 0.2;
      v.root.rotation.y = this.time * 1.2 + i;
    });
    for (const hv of this.hazards) {
      const phase = sim.features.phases[hv.h.id]!;
      const clk = hazardClock(hv.h, sim.clock);
      hv.update(phase, clk.t, clk.duration, this.time);
    }
  }

}
