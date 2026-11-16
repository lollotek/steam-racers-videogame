/**
 * 3D preview of the editor (doc 05 §8, phase E3). The game's own renderer, world builder
 * (`world/build.ts`), crate and hazard views and ink pipeline, on the compiled track of the editor,
 * with an orbit camera. Loaded lazily (dynamic import) when the panel opens: the grid editor stays
 * light. One instance per open panel; `dispose()` frees everything.
 */
import { PerspectiveCamera, Vector3, WebGPURenderer, type Scene } from 'three/webgpu';
import { tunables } from '../core/tunables';
import { getBiome } from '../biomes';
import { InkPipeline } from '../render/pipeline';
import { SharedTex, U } from '../render/ink/ink-uniforms';
import { makeProceduralSet, type ProceduralSet } from '../render/procedural/textures';
import { ParticleSystem } from '../render/fx/particles';
import { SparkSystem } from '../render/fx/sparks';
import { FeatureViews, type FeatureSource } from '../game/feature-views';
import { hazardClock } from '../track/hazards';
import type { CompiledTrack } from '../track/compile';
import type { HazardPhase } from '../track/track-format';
import { buildWorld, type GameWorld } from '../world/build';
import { squareGrid } from '../world/square-grid';
import { disposeScene } from '../world/kit';

export type ViewPreset = 'orbit' | 'board' | 'top';

/** Orbit state: spherical coordinates around a target (yaw 0 looks towards +Z). */
interface Orbit {
  target: Vector3;
  yaw: number;
  pitch: number;
  dist: number;
}

/** Everything that belongs to one built track (rebuilt on change). */
interface Built {
  world: GameWorld;
  scene: Scene;
  pipeline: InkPipeline;
  particles: ParticleSystem;
  sparks: SparkSystem;
  features: FeatureViews;
  source: { track: CompiledTrack; clock: number; features: { pickups: { active: boolean }[]; phases: HazardPhase[] } };
  grid: ReturnType<typeof squareGrid>;
}

const DEG = Math.PI / 180;

export class Preview3D {
  readonly renderer: WebGPURenderer;
  readonly camera = new PerspectiveCamera(40, 1, 0.5, 3000);
  backend: 'webgpu' | 'webgl2' = 'webgpu';
  /** Hazards cycle (clock running) or stand still in their idle state. */
  animate = true;
  private tex: ProceduralSet;
  private built: Built | null = null;
  private orbit: Orbit = { target: new Vector3(), yaw: 35 * DEG, pitch: 40 * DEG, dist: 300 };
  private goal: Orbit | null = null;
  private last = -1;
  private ro: ResizeObserver;
  private showGrid = false;
  private drag: { x: number; y: number; pan: boolean } | null = null;
  /** The world's fog start (m); the preview pushes it out with the camera distance. */
  private fogStart = 55;
  private tmp = new Vector3();

  private constructor(private readonly host: HTMLElement) {
    this.renderer = new WebGPURenderer({ antialias: true, powerPreference: 'high-performance' });
    this.tex = makeProceduralSet(1);
    SharedTex.tam = this.tex.tam;
    SharedTex.noise = this.tex.noise;
    SharedTex.paper = this.tex.paper;
    this.ro = new ResizeObserver(() => this.resize());
  }

  /** World of the track on screen (null before the first build). */
  get biome(): string | null {
    return this.built?.source.track.file.biome ?? null;
  }

  static async create(host: HTMLElement): Promise<Preview3D> {
    const p = new Preview3D(host);
    await p.renderer.init();
    p.backend = (p.renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
    const canvas = p.renderer.domElement;
    canvas.className = 'preview-canvas';
    canvas.dataset.testid = 'preview-canvas';
    host.appendChild(canvas);
    p.renderer.shadowMap.enabled = true;
    p.bindInput(canvas);
    p.ro.observe(host);
    p.resize();
    p.renderer.setAnimationLoop(p.frame);
    return p;
  }

  /** Build (or rebuild) the world of a compiled track. Keeps the camera unless `frame` is set. */
  setTrack(track: CompiledTrack, seed: number, frame: boolean): void {
    this.clear();
    const world = buildWorld(getBiome(track.file.biome), this.tex, seed, track);
    this.fogStart = tunables.get<number>('fog.start');
    const scene = world.scene;
    const particles = new ParticleSystem(scene, this.tex.puff, seed + 99);
    for (const e of world.emitters) particles.addEmitter(e);
    const sparks = new SparkSystem(scene, seed + 7);
    const source: Built['source'] = {
      track,
      clock: 0,
      features: { pickups: track.pickups.map(() => ({ active: true })), phases: track.hazards.map(() => 'idle' as HazardPhase) },
    };
    const features = new FeatureViews(scene, source as FeatureSource, this.tex, particles, sparks);
    const grid = squareGrid(track);
    grid.visible = this.showGrid;
    scene.add(grid);
    world.keyLight.castShadow = true;
    world.keyLight.shadow.mapSize.set(2048, 2048);
    const pipeline = new InkPipeline(this.renderer, scene, this.camera, { noise: this.tex.noise, paper: this.tex.paper });
    pipeline.updateResolution();
    this.built = { world, scene, pipeline, particles, sparks, features, source, grid };
    if (frame) this.view('orbit', true);
  }

  setGrid(on: boolean): void {
    this.showGrid = on;
    if (this.built) this.built.grid.visible = on;
  }

  /** Camera presets: free orbit 3/4 view, the game's board camera angles, straight from above. */
  view(preset: ViewPreset, instant = false): void {
    const t = this.built?.source.track;
    if (!t) return;
    const b = t.bounds;
    const centre = new Vector3((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 60;
    const fit = span / 2 / Math.tan((this.camera.fov / 2) * DEG);
    let goal: Orbit;
    if (preset === 'top') goal = { target: centre, yaw: 0, pitch: 89.9 * DEG, dist: fit * 1.05 };
    else if (preset === 'board') {
      // Azimuth / pitch of the race camera (camera.board.*): the tabletop look.
      goal = { target: centre, yaw: tunables.get<number>('camera.board.azimuth') * DEG, pitch: tunables.get<number>('camera.board.pitch') * DEG, dist: fit * 1.15 };
    } else goal = { target: centre, yaw: this.orbit.yaw, pitch: 38 * DEG, dist: fit * 1.1 };
    this.moveTo(goal, instant);
  }

  /** Centre the view on the samples of one piece (the tile selected in the grid). */
  focusPiece(index: number): void {
    const t = this.built?.source.track;
    if (!t) return;
    const pts = t.samples.filter((s) => s.piece === index);
    if (!pts.length) return;
    const c = new Vector3();
    for (const p of pts) c.add(new Vector3(p.x, p.y, p.z));
    c.divideScalar(pts.length);
    this.moveTo({ target: c, yaw: this.orbit.yaw, pitch: Math.max(25 * DEG, Math.min(70 * DEG, this.orbit.pitch)), dist: Math.min(this.orbit.dist, 120) }, false);
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    this.clear();
    for (const v of Object.values(this.tex)) {
      if (Array.isArray(v)) v.forEach((t) => t.dispose?.());
      else (v as { dispose?: () => void } | null)?.dispose?.();
    }
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private clear(): void {
    const b = this.built;
    if (!b) return;
    this.built = null;
    b.pipeline.dispose();
    b.world.keyLight.shadow.map?.dispose();
    b.world.dispose();
    disposeScene(b.scene, sharedTextures(this.tex));
  }

  private moveTo(goal: Orbit, instant: boolean): void {
    if (instant) {
      this.orbit = { ...goal, target: goal.target.clone() };
      this.goal = null;
    } else this.goal = { ...goal, target: goal.target.clone() };
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.built?.pipeline.updateResolution();
  }

  private frame = (time: number) => {
    const dt = this.last < 0 ? 0 : Math.min(0.1, (time - this.last) / 1000);
    this.last = time;
    const b = this.built;
    if (!b) return;
    if (this.goal) {
      const k = 1 - Math.exp(-dt * 8);
      const o = this.orbit;
      o.target.lerp(this.goal.target, k);
      o.yaw += shortAngle(this.goal.yaw - o.yaw) * k;
      o.pitch += (this.goal.pitch - o.pitch) * k;
      o.dist += (this.goal.dist - o.dist) * k;
      if (o.target.distanceTo(this.goal.target) < 0.05 && Math.abs(this.goal.dist - o.dist) < 0.05 && Math.abs(this.goal.pitch - o.pitch) < 1e-3) this.goal = null;
    }
    const o = this.orbit;
    const cp = Math.cos(o.pitch);
    this.camera.position.set(o.target.x - Math.sin(o.yaw) * cp * o.dist, o.target.y + Math.sin(o.pitch) * o.dist, o.target.z - Math.cos(o.yaw) * cp * o.dist);
    this.camera.lookAt(o.target);
    this.camera.far = Math.max(1500, o.dist * 4);
    this.camera.updateProjectionMatrix();

    // Fog as in the race around the target (the race camera is ~50 m away), pushed out with the
    // zoom so the whole track stays readable from far away.
    U.fogStart.value = this.fogStart + Math.max(0, o.dist - 50);

    if (this.animate) b.source.clock += dt;
    // Hazard phases follow the preview clock (in a race TrackFeatures sets them).
    b.source.track.hazards.forEach((h) => (b.source.features.phases[h.id] = this.animate ? hazardClock(h, b.source.clock).phase : 'idle'));
    b.world.update(dt, o.target);
    b.features.update(this.animate ? dt : 0);
    b.particles.update(dt, this.camera);
    b.sparks.update(dt, this.camera);
    // Fit the sun's shadow box to the view (up to the whole track from far away).
    // world.update puts the sun 120 m from the focus (race framing); from far away the box must
    // hold the whole view, so the sun moves back with it.
    const key = b.world.keyLight;
    const sc = key.shadow.camera;
    const half = Math.max(75, Math.min(450, o.dist * 0.7));
    this.tmp.copy(key.position).sub(key.target.position).normalize();
    key.position.copy(key.target.position).addScaledVector(this.tmp, half * 1.5 + 120);
    if (sc.right !== half) {
      sc.left = sc.bottom = -half;
      sc.right = sc.top = half;
      sc.far = half * 4 + 300;
      sc.updateProjectionMatrix();
    }
    b.pipeline.render();
  };

  private bindInput(el: HTMLCanvasElement): void {
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey };
      this.goal = null;
    });
    el.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      d.x = e.clientX;
      d.y = e.clientY;
      const o = this.orbit;
      if (d.pan) {
        // Pan on the ground plane, scaled to the distance.
        const k = (o.dist * Math.tan((this.camera.fov / 2) * DEG) * 2) / Math.max(1, el.clientHeight);
        const fx = Math.sin(o.yaw);
        const fz = Math.cos(o.yaw);
        // Screen right = −(driver's left of the view direction) on the ground.
        o.target.x += (fz * dx + fx * dy) * k;
        o.target.z += (-fx * dx + fz * dy) * k;
      } else {
        o.yaw -= dx * 0.006;
        o.pitch = Math.max(5 * DEG, Math.min(89.9 * DEG, o.pitch + dy * 0.005));
      }
    });
    const end = () => (this.drag = null);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.goal = null;
        this.orbit.dist = Math.max(8, Math.min(2500, this.orbit.dist * Math.exp(e.deltaY * 0.0012)));
      },
      { passive: false },
    );
  }
}

/** Textures of the shared procedural set (kept when a scene is disposed). */
function sharedTextures(tex: ProceduralSet): Set<unknown> {
  const keep = new Set<unknown>();
  for (const v of Object.values(tex)) {
    if (Array.isArray(v)) v.forEach((t) => keep.add(t));
    else if (v && typeof v === 'object') keep.add(v);
  }
  return keep;
}

function shortAngle(a: number): number {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
