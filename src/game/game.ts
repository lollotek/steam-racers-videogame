/**
 * Game shell: fixed-step simulation + interpolated presentation (doc 03 §4),
 * per-player slots (input, vehicle, camera, viewport) for single player and PC split screen.
 * M1: foundry look-test world rendered through the ink pipeline (doc 02).
 */
import { Vector3, type Scene } from 'three/webgpu';
import { FixedStepLoop } from '../core/loop';
import { EventBus } from '../core/events';
import type { Flags } from '../core/flags';
import { RngStreams } from '../core/rng';
import { tunables } from '../core/tunables';
import { PlayerInput } from '../input/input-manager';
import { KeyboardSource, P1_KEYS, P2_KEYS, mergeBindings } from '../input/keyboard';
import { GamepadSource } from '../input/gamepad';
import type { TouchSource } from '../input/touch';
import type { InputSource } from '../input/actions';
import { DynamicResolution, TIERS, type QualityTierName } from '../render/quality';
import { type RendererHandle, pixelRatioFor } from '../render/renderer';
import { InkPipeline } from '../render/pipeline';
import { SharedTex, U } from '../render/ink/ink-uniforms';
import { makeProceduralSet } from '../render/procedural/textures';
import { ParticleSystem, type Emitter } from '../render/fx/particles';
import { FollowCamera } from './follow-camera';
import { buildFoundry, type FoundryWorld } from './foundry-scene';
import { buildHotRod, buildSteamTank, type VehicleRig } from './vehicles';
import { type VehicleState, canPush, createVehicleState, stepVehicle } from './test-vehicle';
import { VehicleTag } from '../ui/vehicle-tag';
import type { SteamReadout } from '../ui/steam-pips';
import { ui } from '../ui/state';

/** Placeholder identity colors until S5 is decided (doc 02 §13.1). */
export const IDENTITY_COLORS = ['#E8E2D0', '#D94848', '#3F7FE0', '#E0C040', '#4FBF6A', '#B060D0', '#40C8C0', '#E07A9A'];

const ARENA_RADIUS = 175;

tunables.registerGroup('hud', [
  { key: 'hud.vehicleTag', type: 'boolean', default: true, label: 'Gear + steam under vehicle' },
  { key: 'hud.tagOffset', type: 'number', default: 4, min: 0, max: 12, step: 0.25, unit: 'm', label: 'Tag offset behind vehicle' },
]);

tunables.registerGroup('showcase', [
  { key: 'showcase.aiSpeed', type: 'number', default: 16, min: 0, max: 40, step: 0.5, unit: 'm/s', label: 'Demo rival speed' },
  { key: 'showcase.smokePerSpeed', type: 'number', default: 0.6, min: 0, max: 4, step: 0.05, label: 'Exhaust per m/s' },
  { key: 'showcase.cameraTarget', type: 'option', default: 'player', options: ['player', 'rival'], label: 'Camera follows' },
]);

export interface PlayerSlot {
  index: number;
  input: PlayerInput;
  state: VehicleState;
  prev: VehicleState;
  rig: VehicleRig;
  camera: FollowCamera;
  exhaust: Emitter[];
  tag: VehicleTag;
}

interface Rival {
  rig: VehicleRig;
  t: number;
  exhaust: Emitter[];
}

export interface GameOptions {
  flags: Flags;
  isMobile: boolean;
  tier: QualityTierName;
  touch: TouchSource;
}

export class Game {
  readonly loop = new FixedStepLoop();
  readonly bus = new EventBus();
  readonly rng: RngStreams;
  readonly world: FoundryWorld;
  readonly scene: Scene;
  readonly slots: PlayerSlot[] = [];
  readonly dynres: DynamicResolution;
  readonly particles: ParticleSystem;
  readonly pipeline: InkPipeline | null;
  private rivals: Rival[] = [];
  frames = 0;
  private lastTime = -1;
  private hudTimer = 0;
  private fpsAcc = { frames: 0, time: 0 };
  private tmp = new Vector3();

  constructor(
    readonly gfx: RendererHandle,
    readonly opts: GameOptions,
  ) {
    const { flags, isMobile } = opts;
    this.rng = new RngStreams(flags.seed);

    tunables.registerGroup('quality', [
      { key: 'quality.tier', type: 'option', default: opts.tier, options: ['low', 'medium', 'high', 'ultra'], label: 'Tier' },
      { key: 'quality.dynamicResolution', type: 'boolean', default: true, label: 'Dynamic resolution' },
      { key: 'quality.targetFps', type: 'number', default: isMobile ? 30 : 60, min: 20, max: 144, step: 1, label: 'Target FPS' },
    ]);
    tunables.registerGroup('sim', [
      { key: 'sim.timeScale', type: 'number', default: 1, min: 0, max: 4, step: 0.05, label: 'Time scale' },
    ]);

    this.dynres = new DynamicResolution(TIERS[opts.tier], tunables.get('quality.targetFps'));
    tunables.onChange((key, value) => {
      if (key === 'quality.tier') this.setTier(value as QualityTierName);
      if (key === 'quality.targetFps') this.dynres.targetFps = value as number;
      if (key === 'quality.dynamicResolution') this.dynres.enabled = value as boolean;
      if (key === 'sim.timeScale') this.loop.timeScale = value as number;
      if (key === 'ink.hatchEnabled') this.applyHatching();
    });

    // Procedural textures shared by materials and post (doc 02 §4.1, S3).
    const tex = makeProceduralSet(flags.seed);
    SharedTex.tam = tex.tam;
    SharedTex.noise = tex.noise;
    SharedTex.paper = tex.paper;

    this.world = buildFoundry(tex, flags.seed);
    this.scene = this.world.scene;
    this.particles = new ParticleSystem(this.scene, tex.puff, flags.seed + 99);
    for (const e of this.world.emitters) this.particles.addEmitter(e);

    // Split screen is PC only (D5).
    const players = isMobile ? 1 : flags.players;
    ui.splitScreen.value = players === 2;
    for (let i = 0; i < players; i++) this.addSlot(i, players, tex);

    // Demo rival following the racing line, so the look test has something moving (M1 only).
    if (players === 1) {
      const rig = buildSteamTank(tex, IDENTITY_COLORS[1]!);
      this.scene.add(rig.root);
      this.rivals.push({ rig, t: 0.985, exhaust: this.stackEmitters(rig) });
    }

    this.gfx.renderer.shadowMap.enabled = true;
    this.pipeline = players === 1 ? new InkPipeline(gfx.renderer, this.scene, this.slots[0]!.camera.camera, { noise: tex.noise, paper: tex.paper }) : null;

    this.setTier(opts.tier);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.onResize();
  }

  private stackEmitters(rig: VehicleRig): Emitter[] {
    return rig.stacks.map((s) => {
      s.getWorldPosition(this.tmp);
      return this.particles.addEmitter({
        kind: 'smoke',
        rate: 0,
        position: { x: this.tmp.x, y: this.tmp.y, z: this.tmp.z },
        velocity: { x: 0, y: 2.5, z: 0 },
        spread: 0.4,
        life: [1.2, 2.4],
        size: [0.8, 3.2],
      });
    });
  }

  private addSlot(index: number, players: number, tex: ReturnType<typeof makeProceduralSet>): void {
    const sources: InputSource[] = [];
    if (players === 1) {
      // Single player: every device controls the car (WASD and arrows both work).
      sources.push(new KeyboardSource('kb', mergeBindings(P1_KEYS, P2_KEYS)), new GamepadSource(0), this.opts.touch);
    } else {
      sources.push(new KeyboardSource(`kb-p${index + 1}`, index === 0 ? P1_KEYS : P2_KEYS), new GamepadSource(index));
    }
    // Start on the grid: curve start, side by side.
    const c = this.world.curve;
    const t = 0;
    const p = c.getPointAt(t);
    const tan = c.getTangentAt(t);
    const left = new Vector3(tan.z, 0, -tan.x);
    const offset = players === 2 ? (index === 0 ? 3 : -3) : 2.5;
    const state = createVehicleState(p.x + left.x * offset, p.z + left.z * offset, Math.atan2(tan.x, tan.z));
    const rig = index === 0 ? buildHotRod(tex, IDENTITY_COLORS[0]!) : buildSteamTank(tex, IDENTITY_COLORS[2]!);
    this.scene.add(rig.root);
    this.slots.push({
      index,
      input: new PlayerInput(index, sources),
      state,
      prev: { ...state },
      rig,
      camera: new FollowCamera(1),
      exhaust: this.stackEmitters(rig),
      tag: new VehicleTag(document.getElementById('ui') ?? document.body, index),
    });
  }

  /** Compile every material before the first frame (doc 03 §10.1) so the race does not start with hitches. */
  async warmUp(): Promise<void> {
    const cam = this.slots[0]!.camera.camera;
    const t0 = performance.now();
    try {
      await this.gfx.renderer.compileAsync(this.scene, cam);
    } catch (e) {
      console.warn('[render] shader warm-up failed', e);
    }
    console.info(`[render] shaders compiled in ${Math.round(performance.now() - t0)} ms`);
  }

  start(): void {
    this.gfx.renderer.setAnimationLoop(this.frame);
  }

  setPaused(paused: boolean): void {
    if (this.loop.paused === paused) return;
    this.loop.paused = paused;
    this.loop.resetAccumulator();
    ui.paused.value = paused;
    this.bus.emit('pauseChanged', { paused });
  }

  private setTier(name: QualityTierName): void {
    const tier = TIERS[name];
    this.dynres.setTier(tier);
    ui.tier.value = name;
    // Shadows (doc 02 §14): blob shadows on Low come later; for now Low disables the shadow map.
    const key = this.world.keyLight;
    key.castShadow = tier.shadowMapSize > 0;
    if (tier.shadowMapSize > 0) {
      key.shadow.mapSize.set(tier.shadowMapSize, tier.shadowMapSize);
      key.shadow.map?.dispose();
      key.shadow.map = null;
    }
    this.applyHatching();
    this.applyPixelRatio();
    this.bus.emit('qualityTierChanged', { tier: name, renderScale: this.dynres.scale });
  }

  private applyHatching(): void {
    U.hatchOn.value = this.dynres.tier.hatching && tunables.get<boolean>('ink.hatchEnabled') ? 1 : 0;
  }

  private applyPixelRatio(): void {
    const pr = pixelRatioFor(window.devicePixelRatio || 1, this.dynres.tier.maxDpr, this.dynres.scale);
    this.gfx.renderer.setPixelRatio(pr);
    this.pipeline?.updateResolution();
    ui.renderScale.value = this.dynres.scale;
  }

  private onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.gfx.renderer.setSize(w, h, false);
    const split = this.slots.length === 2;
    for (const s of this.slots) s.camera.setAspect(split ? w / (h / 2) : w / h);
    this.pipeline?.updateResolution();
  };

  private onVisibility = () => {
    if (document.hidden) this.setPaused(true);
  };

  /** One fixed simulation step for every player. */
  private simStep(dt: number): void {
    for (const s of this.slots) {
      const frame = s.input.sample();
      if (frame.pressed.pause) {
        this.setPaused(true);
        return;
      }
      Object.assign(s.prev, s.state);
      if (frame.pressed.reposition) this.reposition(s);
      const res = stepVehicle(s.state, frame, dt, ARENA_RADIUS);
      if (res.gearChanged) this.bus.queue('gearChanged', { racer: s.index, gear: s.state.gear });
    }
    this.bus.flush();
  }

  /** Put the vehicle back on the track centre line, facing along it (gameplay.md §5.1 "Riposiziona"). */
  private reposition(s: PlayerSlot): void {
    const c = this.world.curve;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < 400; i++) {
      const p = c.getPointAt(i / 400);
      const d = (p.x - s.state.x) ** 2 + (p.z - s.state.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i / 400;
      }
    }
    const p = c.getPointAt(best);
    const tan = c.getTangentAt(best);
    s.state.x = p.x;
    s.state.z = p.z;
    s.state.heading = Math.atan2(tan.x, tan.z);
    s.state.speed = 0;
    s.state.gear = 1;
    Object.assign(s.prev, s.state);
  }

  private frame = (timeMs: number) => {
    const now = timeMs / 1000;
    const realDt = this.lastTime < 0 ? 1 / 60 : now - this.lastTime;
    this.lastTime = now;
    this.frames++;

    if (this.loop.paused) {
      // Still read input so the pause button can resume.
      for (const s of this.slots) if (s.input.sample().pressed.pause) this.setPaused(false);
    }

    const tick = this.loop.advance(realDt);
    for (let i = 0; i < tick.steps; i++) {
      this.simStep(this.loop.step);
      if (this.loop.paused) break;
    }
    const simDt = this.loop.paused ? 0 : tick.frameDt * this.loop.timeScale;

    // Presentation: interpolate, animate rigs, camera.
    const maxSpeed = tunables.get('vehicle.maxSpeed');
    for (const s of this.slots) {
      const a = tick.alpha;
      const x = s.prev.x + (s.state.x - s.prev.x) * a;
      const z = s.prev.z + (s.state.z - s.prev.z) * a;
      const heading = lerpAngle(s.prev.heading, s.state.heading, a);
      s.rig.root.position.set(x, 0, z);
      s.rig.root.rotation.y = heading;
      this.animateRig(s.rig, s.state.speed, simDt, s.exhaust);
    }
    for (const r of this.rivals) this.updateRival(r, simDt);
    // One camera update per slot per frame (the damped focus would otherwise average two targets).
    const rival = this.rivals[0];
    const followRival = !!rival && tunables.get<string>('showcase.cameraTarget') === 'rival';
    for (const s of this.slots) {
      if (followRival && s.index === 0) {
        const pos = rival!.rig.root.position;
        const speed = tunables.get('showcase.aiSpeed');
        s.camera.update({ x: pos.x, z: pos.z, heading: rival!.rig.root.rotation.y, speedFrac: Math.min(1, speed / maxSpeed) }, tick.frameDt);
      } else {
        const p = s.rig.root.position;
        s.camera.update({ x: p.x, z: p.z, heading: s.rig.root.rotation.y, speedFrac: Math.min(1, Math.abs(s.state.speed) / maxSpeed) }, tick.frameDt);
      }
    }

    const cam = this.slots[0]!.camera.camera;
    this.world.update(simDt, this.tmp.set(cam.position.x, 0, cam.position.z).lerp(this.slots[0]!.rig.root.position, 0.7));
    this.particles.update(simDt, cam);
    this.render();
    this.updateTags(followRival);

    if (!this.loop.paused && this.dynres.update(realDt * 1000)) this.applyPixelRatio();
    this.updateHud(tick.frameDt);
  };

  private animateRig(rig: VehicleRig, speed: number, dt: number, exhaust: Emitter[]): void {
    for (const w of rig.wheels) w.rotation.x += (speed * dt) / 0.9;
    rig.banner.rotation.x = Math.sin(this.loop.simTime * 6) * 0.05 * Math.min(1, Math.abs(speed) / 10);
    rig.root.updateMatrixWorld();
    rig.stacks.forEach((s, i) => {
      const e = exhaust[i];
      if (!e) return;
      s.getWorldPosition(this.tmp);
      e.position.x = this.tmp.x;
      e.position.y = this.tmp.y;
      e.position.z = this.tmp.z;
      e.rate = 3 + Math.abs(speed) * tunables.get('showcase.smokePerSpeed');
    });
  }

  private updateRival(r: Rival, dt: number): void {
    const c = this.world.curve;
    const speed = tunables.get('showcase.aiSpeed');
    r.t = (r.t + (speed * dt) / this.world.trackLength) % 1;
    const p = c.getPointAt(r.t);
    const tan = c.getTangentAt(r.t);
    const left = new Vector3(tan.z, 0, -tan.x);
    r.rig.root.position.set(p.x - left.x * 2.5, 0, p.z - left.z * 2.5);
    r.rig.root.rotation.y = Math.atan2(tan.x, tan.z);
    this.animateRig(r.rig, speed, dt, r.exhaust);
  }

  private render(): void {
    const r = this.gfx.renderer;
    if (this.pipeline) {
      this.pipeline.render();
      return;
    }
    // Split screen (PC): direct render per viewport, no post chain yet (doc 03 §10.4, M3).
    const w = window.innerWidth;
    const h = window.innerHeight / 2;
    r.setScissorTest(true);
    this.slots.forEach((s, i) => {
      r.setViewport(0, i * h, w, h);
      r.setScissor(0, i * h, w, h);
      r.render(this.scene, s.camera.camera);
    });
    r.setScissorTest(false);
  }

  /** Placeholder boiler readout (M3: real boiler component). */
  private steamOf(s: PlayerSlot): SteamReadout {
    return { pv: s.state.pv, cal: tunables.get('boiler.cal'), regen: s.state.pvRegen, usable: canPush(s.state) };
  }

  /** Gear + steam pips pinned just behind (= below on screen) each player's vehicle. */
  private updateTags(followRival: boolean): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const split = this.slots.length === 2;
    const back = tunables.get('hud.tagOffset');
    for (const s of this.slots) {
      const vh = split ? h / 2 : h;
      // Split viewports: slot 0 is rendered in the top half (see render()).
      const vp = { left: 0, top: split ? s.index * vh : 0, width: w, height: vh };
      const r = s.rig.root;
      const anchor = { x: r.position.x - Math.sin(r.rotation.y) * back, y: 0, z: r.position.z - Math.cos(r.rotation.y) * back };
      const visible = !this.loop.paused && !(followRival && s.index === 0) && tunables.get<boolean>('hud.vehicleTag');
      s.tag.update(anchor, s.camera.camera, vp, s.state.gear, this.steamOf(s), visible);
    }
  }

  private updateHud(dt: number): void {
    this.fpsAcc.frames++;
    this.fpsAcc.time += dt;
    if (this.fpsAcc.time >= 0.5) {
      ui.fps.value = Math.round(this.fpsAcc.frames / this.fpsAcc.time);
      this.fpsAcc = { frames: 0, time: 0 };
    }
    this.hudTimer += dt;
    if (this.hudTimer < 1 / 15) return; // text HUD throttled (doc 03 §13)
    this.hudTimer = 0;
    ui.players.value = this.slots.map((s) => ({
      index: s.index,
      gear: s.state.gear,
      speedKmh: Math.round(Math.abs(s.state.speed) * 3.6),
      pushReady: canPush(s.state),
      steam: this.steamOf(s),
      device: s.input.lastDevice,
      identityColor: IDENTITY_COLORS[s.index] ?? '#ffffff',
    }));
  }

  /** Read-only snapshot for tests and the debug panel. */
  snapshot() {
    return {
      backend: this.gfx.backend,
      tier: ui.tier.value,
      renderScale: this.dynres.scale,
      frames: this.frames,
      simSteps: this.loop.stepCount,
      paused: this.loop.paused,
      particles: this.particles.count,
      players: this.slots.map((s) => ({
        gear: s.state.gear,
        pushCooldown: s.state.pushCooldown,
        pv: s.state.pv,
        speed: s.state.speed,
        x: s.state.x,
        z: s.state.z,
        heading: s.state.heading,
        input: s.input.describe(),
        device: s.input.lastDevice,
      })),
    };
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
