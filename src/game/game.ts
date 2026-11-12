/**
 * M0 game shell: fixed-step simulation + interpolated presentation (doc 03 §4),
 * per-player slots (input, vehicle, camera, viewport) for single player and PC split screen.
 */
import type { Group, Scene } from 'three/webgpu';
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
import { FollowCamera } from './follow-camera';
import { ARENA_RADIUS, buildTestScene, buildTestVehicle } from './test-scene';
import { type VehicleState, createVehicleState, stepVehicle } from './test-vehicle';
import { ui } from '../ui/state';

/** Placeholder identity colors until S5 is decided (doc 02 §13.1). */
export const IDENTITY_COLORS = ['#E8E2D0', '#D94848', '#3F7FE0', '#E0C040', '#4FBF6A', '#B060D0', '#40C8C0', '#E07A9A'];

export interface PlayerSlot {
  index: number;
  input: PlayerInput;
  state: VehicleState;
  prev: VehicleState;
  view: Group;
  camera: FollowCamera;
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
  readonly scene: Scene;
  readonly slots: PlayerSlot[] = [];
  readonly dynres: DynamicResolution;
  frames = 0;
  private lastTime = -1;
  private hudTimer = 0;
  private fpsAcc = { frames: 0, time: 0 };

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
    });

    this.scene = buildTestScene(flags.seed);

    // Split screen is PC only (D5).
    const players = isMobile ? 1 : flags.players;
    ui.splitScreen.value = players === 2;
    for (let i = 0; i < players; i++) this.addSlot(i, players);

    this.setTier(opts.tier);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.onResize();
  }

  private addSlot(index: number, players: number): void {
    const sources: InputSource[] = [];
    if (players === 1) {
      // Single player: every device controls the car (WASD and arrows both work).
      sources.push(new KeyboardSource('kb', mergeBindings(P1_KEYS, P2_KEYS)), new GamepadSource(0), this.opts.touch);
    } else {
      sources.push(new KeyboardSource(`kb-p${index + 1}`, index === 0 ? P1_KEYS : P2_KEYS), new GamepadSource(index));
    }
    const angle = (index === 0 ? 0 : 0.06) * Math.PI;
    const r = 70;
    const state = createVehicleState(Math.sin(angle) * r + (index ? 4 : 0), Math.cos(angle) * r, Math.PI / 2);
    const view = buildTestVehicle(IDENTITY_COLORS[index] ?? '#ffffff');
    this.scene.add(view);
    this.slots.push({
      index,
      input: new PlayerInput(index, sources),
      state,
      prev: { ...state },
      view,
      camera: new FollowCamera(1),
    });
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
    this.dynres.setTier(TIERS[name]);
    ui.tier.value = name;
    this.applyPixelRatio();
    this.bus.emit('qualityTierChanged', { tier: name, renderScale: this.dynres.scale });
  }

  private applyPixelRatio(): void {
    const pr = pixelRatioFor(window.devicePixelRatio || 1, this.dynres.tier.maxDpr, this.dynres.scale);
    this.gfx.renderer.setPixelRatio(pr);
    ui.renderScale.value = this.dynres.scale;
  }

  private onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.gfx.renderer.setSize(w, h, false);
    const split = this.slots.length === 2;
    for (const s of this.slots) s.camera.setAspect(split ? w / (h / 2) : w / h);
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
      const res = stepVehicle(s.state, frame, dt, ARENA_RADIUS);
      if (res.gearChanged) this.bus.queue('gearChanged', { racer: s.index, gear: s.state.gear });
    }
    this.bus.flush();
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

    // Presentation: interpolate, camera, render.
    const maxSpeed = tunables.get('vehicle.maxSpeed');
    for (const s of this.slots) {
      const a = tick.alpha;
      const x = s.prev.x + (s.state.x - s.prev.x) * a;
      const z = s.prev.z + (s.state.z - s.prev.z) * a;
      const heading = lerpAngle(s.prev.heading, s.state.heading, a);
      s.view.position.set(x, 0, z);
      s.view.rotation.y = heading;
      s.camera.update({ x, z, heading, speedFrac: Math.min(1, Math.abs(s.state.speed) / maxSpeed) }, tick.frameDt);
    }
    this.render();

    if (!this.loop.paused && this.dynres.update(realDt * 1000)) this.applyPixelRatio();
    this.updateHud(tick.frameDt);
  };

  private render(): void {
    const r = this.gfx.renderer;
    if (this.slots.length === 1) {
      r.render(this.scene, this.slots[0]!.camera.camera);
      return;
    }
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
      pushReady: s.state.pushCooldown === 0,
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
      players: this.slots.map((s) => ({
        gear: s.state.gear,
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
