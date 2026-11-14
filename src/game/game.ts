/**
 * Game shell (doc 03 §4): the race simulation (RaceSim, fixed 60 Hz) + interpolated presentation.
 * Per-player slots own input, camera and viewport (single player, or PC split screen).
 * M2: Rapier vehicles on the compiled block track, laps, countdown, results, autopilot rivals.
 * M3: race rules (start test, boiler, hull, ramming, front cannon), AI drivers, centre prompts,
 *     banners, minimap, retired racers in the results.
 * M4: one Game = one race, built from a RaceSetup (track, entrants, grid, tunes) by the front-end
 *     flow (src/flow); `dispose()` frees it before the next race (doc 04 B1/B2).
 */
import { Quaternion, Vector3, type Scene } from 'three/webgpu';
import { FixedStepLoop } from '../core/loop';
import { EventBus } from '../core/events';
import type { Flags } from '../core/flags';
import { RngStreams } from '../core/rng';
import { tunables } from '../core/tunables';
import { PlayerInput } from '../input/input-manager';
import { KeyboardSource, P1_KEYS, P2_KEYS, mergeBindings } from '../input/keyboard';
import { GamepadSource } from '../input/gamepad';
import type { TouchSource } from '../input/touch';
import type { ActionFrame, InputSource } from '../input/actions';
import { DynamicResolution, TIERS, type QualityTierName } from '../render/quality';
import { type RendererHandle, pixelRatioFor } from '../render/renderer';
import { InkPipeline } from '../render/pipeline';
import { SplitCompositor } from '../render/split';
import { SharedTex, U } from '../render/ink/ink-uniforms';
import { makeProceduralSet, type ProceduralSet } from '../render/procedural/textures';
import { ParticleSystem, type Emitter } from '../render/fx/particles';
import { SparkSystem } from '../render/fx/sparks';
import type { ImpactInfo } from '../sim/race-sim';
import type { Barricade } from '../track/track-format';
import { FollowCamera, dampAngle } from './follow-camera';
import { buildWorld, type GameWorld } from '../world/build';
import { squareGrid } from '../world/square-grid';
import { getBiome } from '../biomes';
import { FeatureViews } from './feature-views';
import { buildHotRod, buildSteamTank, type VehicleRig } from './vehicles';
import { RaceSim, SIM_STEP } from '../sim/race-sim';
import { HOT_ROD, STEAM_TANK, type VehicleSpec } from '../vehicles/vehicle-physics';
import { createDriver, driveRacer, type DriverState } from '../ai/driver';
import type { RuleEvent } from '../sim/race-rules';
import { hullCondition } from '../rules/hull';
import { coneHalfAngle, isLocked } from '../rules/cannon';
import { PlayerGauges, type GaugeFrame } from '../ui/gauges';
import { Minimap } from '../ui/minimap';
import type { Banner, ResultRow } from '../ui/state';
import type { ViewportRect } from '../ui/vehicle-tag';
import { compileTrack } from '../track/compile';
import { LOOSE_SURFACES, type TrackFile } from '../track/track-format';
import { getTrack } from '../tracks';
import { IDENTITY_COLORS, RIVAL_NAMES, aiVehicle, playerName, type RaceOutcome, type VehicleId, type VehicleTune } from '../cup/cup';
import { disposeScene } from '../world/kit';
import { ui } from '../ui/state';
import { VehicleTag } from '../ui/vehicle-tag';
import type { SteamReadout } from '../ui/steam-pips';
import { canPush, type GearboxState } from '../vehicles/gearbox';
import { boilerCal } from '../rules/boiler';

export { IDENTITY_COLORS };

tunables.registerGroup('hud', [
  { key: 'hud.vehicleTag', type: 'boolean', default: true, label: 'Gear + steam under vehicle' },
  { key: 'hud.tagOffset', type: 'number', default: 2.6, min: 0, max: 8, step: 0.1, unit: 'm', label: 'Tag distance below the vehicle (screen down)' },
]);

tunables.registerGroup('showcase', [
  { key: 'showcase.smokePerSpeed', type: 'number', default: 0.6, min: 0, max: 4, step: 0.05, label: 'Exhaust per m/s' },
  { key: 'showcase.cameraTarget', type: 'option', default: 'player', options: ['player', 'rival'], label: 'Camera follows' },
  { key: 'showcase.cameraTrackBlend', type: 'number', default: 0.7, min: 0, max: 1, step: 0.05, label: 'Camera: track tangent vs heading' },
  { key: 'showcase.playerAutopilot', type: 'boolean', default: false, label: 'Player autopilot (demo)' },
]);

/** Feedback per barricade: metal throws sparks, soft edges throw dust (vehicle impacts: sparks). */
const EDGE_FX: Record<Barricade, { sparks: number; dust: number }> = {
  earth: { sparks: 0, dust: 1 },
  riveted: { sparks: 1, dust: 0 },
  hedgehog: { sparks: 1.3, dust: 0 },
  corrugated: { sparks: 1, dust: 0 },
  sandbags: { sparks: 0, dust: 1.2 },
  barbed: { sparks: 0.5, dust: 0.3 },
  stone: { sparks: 0.8, dust: 0.6 },
  runepylon: { sparks: 1.4, dust: 0 },
  ironrail: { sparks: 1, dust: 0 },
  wreckwall: { sparks: 1.3, dust: 0.2 },
  tyres: { sparks: 0, dust: 0.6 },
  roots: { sparks: 0, dust: 1 },
  crystal: { sparks: 1.2, dust: 0 },
};

export interface PlayerSlot {
  index: number;
  input: PlayerInput;
  camera: FollowCamera;
  /** Smoothed camera yaw (track tangent blended with vehicle heading). */
  camYaw: number;
  /** Gear + steam pips pinned below the vehicle. */
  tag: VehicleTag;
  /** Centre prompts: start test, boiler test, reticle, under fire. */
  gauges: PlayerGauges;
  banners: Banner[];
}

interface RacerView {
  rig: VehicleRig;
  spec: VehicleSpec;
  exhaust: Emitter[];
  dust: Emitter;
  color: string;
  driver: DriverState | null;
  /** Engine smoke / fire / wreck smoke (hull condition). */
  damage: Emitter;
  fireAcc: number;
  /** Fractional scrape sparks / dust carried between frames. */
  scrapeAcc: number;
}

/** One racer of a race. Humans come first (racer index = player slot). */
export interface Entrant {
  name: string;
  color: string;
  vehicle: VehicleId;
  /** Workshop / difficulty multipliers. */
  tune?: VehicleTune;
  /** AI skill (null = the `ai.skill` tunable) and catch-up factor (doc 04 B4). */
  skill?: number | null;
  catchUp?: number;
}

/** Everything a race needs; built by the flow (src/flow) or from the URL flags (`quick`). */
export interface RaceSetup {
  /** quick = straight from the URL flags (tests, dev); single = menu single race; cup = Grand Prix race. */
  mode: 'quick' | 'single' | 'cup';
  track: TrackFile;
  players: 1 | 2;
  entrants: Entrant[];
  /** Grid slot per racer (0 = pole); default: racer index. */
  grid?: number[];
  seed: number;
  /** Adds prize / repair columns to the results rows (Cup). */
  decorate?: (rows: ResultRow[]) => ResultRow[];
}

export interface GameOptions {
  flags: Flags;
  isMobile: boolean;
  tier: QualityTierName;
  touch: TouchSource;
  race: RaceSetup;
  /** Procedural texture set shared across races (built once, doc 03 §10.1). */
  tex?: ProceduralSet;
}

/** The M3 boot: track, racers, players and laps from the URL flags, identity grid. */
export function quickSetup(flags: Flags, isMobile: boolean): RaceSetup {
  const players: 1 | 2 = isMobile ? 1 : flags.players;
  const file = getTrack(flags.track);
  const count = Math.max(players, Math.min(8, flags.racers));
  const entrants: Entrant[] = Array.from({ length: count }, (_, i) => ({
    name: i < players ? playerName(i, players) : RIVAL_NAMES[i]!,
    color: IDENTITY_COLORS[i] ?? '#ffffff',
    vehicle: i === 1 && players === 2 ? 'tank' : aiVehicle(i),
  }));
  return { mode: 'quick', track: flags.laps ? { ...file, laps: flags.laps } : file, players, entrants, seed: flags.seed };
}

export class Game {
  readonly loop = new FixedStepLoop({ step: SIM_STEP });
  readonly bus = new EventBus();
  readonly rng: RngStreams;
  readonly world: GameWorld;
  readonly scene: Scene;
  readonly slots: PlayerSlot[] = [];
  readonly dynres: DynamicResolution;
  readonly particles: ParticleSystem;
  readonly sparks: SparkSystem;
  /** One ink pipeline per player viewport (split screen: each one drawn into its half). */
  readonly pipelines: InkPipeline[];
  private split: SplitCompositor | null = null;
  sim!: RaceSim;
  private views: RacerView[] = [];
  private tex: ProceduralSet;
  private trackFile: TrackFile;
  frames = 0;
  private lastTime = -1;
  private hudTimer = 0;
  private fpsAcc = { frames: 0, time: 0 };
  private tmp = new Vector3();
  private qa = new Quaternion();
  private qb = new Quaternion();
  private players: number;
  private races = 0;
  private bannerId = 0;
  private minimap: Minimap | null = null;
  private features!: FeatureViews;
  private tmp2 = new Vector3();
  private unsubscribe: (() => void)[] = [];
  /** Players who gave up from the pause menu (results show them retired, no repair). */
  private retired = new Set<number>();
  readonly setup: RaceSetup;

  constructor(
    readonly gfx: RendererHandle,
    readonly opts: GameOptions,
  ) {
    const { flags, isMobile } = opts;
    this.setup = opts.race;
    this.rng = new RngStreams(flags.seed);

    tunables.registerGroup('quality', [
      { key: 'quality.tier', type: 'option', default: opts.tier, options: ['low', 'medium', 'high', 'ultra'], label: 'Tier' },
      { key: 'quality.dynamicResolution', type: 'boolean', default: true, label: 'Dynamic resolution' },
      { key: 'quality.targetFps', type: 'number', default: isMobile ? 30 : 60, min: 20, max: 144, step: 1, label: 'Target FPS' },
      // The sun shadow map is a second render of ~300 casters; refreshing it every other frame costs
      // a one-frame lag on moving shadows and saves ~3 ms CPU per frame on phones (tools/phone/perf.ts).
      { key: 'quality.shadowEvery', type: 'number', default: isMobile ? 2 : 1, min: 1, max: 4, step: 1, unit: 'frames', label: 'Sun shadow refresh every' },
    ]);
    tunables.registerGroup('sim', [{ key: 'sim.timeScale', type: 'number', default: 1, min: 0, max: 4, step: 0.05, label: 'Time scale' }]);

    this.dynres = new DynamicResolution(TIERS[opts.tier], tunables.get('quality.targetFps'));
    const off = tunables.onChange((key, value) => {
      if (key === 'quality.tier') this.setTier(value as QualityTierName);
      if (key === 'quality.targetFps') this.dynres.targetFps = value as number;
      if (key === 'quality.dynamicResolution') this.dynres.enabled = value as boolean;
      if (key === 'sim.timeScale') this.loop.timeScale = value as number;
      if (key === 'ink.hatchEnabled') this.applyHatching();
    });
    this.unsubscribe.push(off);

    this.tex = opts.tex ?? makeProceduralSet(flags.seed);
    SharedTex.tam = this.tex.tam;
    SharedTex.noise = this.tex.noise;
    SharedTex.paper = this.tex.paper;

    this.trackFile = this.setup.track;
    // Rain is drawn from the medium tier up (doc 04 D2: weather drops first).
    this.world = buildWorld(getBiome(this.trackFile.biome), this.tex, flags.seed, compileTrack(this.trackFile), { rain: opts.tier !== 'low' });
    this.scene = this.world.scene;
    if (flags.grid) this.scene.add(squareGrid(compileTrack(this.trackFile)));
    this.particles = new ParticleSystem(this.scene, this.tex.puff, flags.seed + 99);
    for (const e of this.world.emitters) this.particles.addEmitter(e);
    this.sparks = new SparkSystem(this.scene, flags.seed + 7);

    // Split screen is PC only (D5).
    this.players = isMobile ? 1 : this.setup.players;
    ui.splitScreen.value = this.players === 2;
    for (let i = 0; i < this.players; i++) this.addSlot(i);

    this.startRace();
    this.features = new FeatureViews(this.scene, this.sim, this.tex, this.particles, this.sparks);
    this.minimap = new Minimap(worldUi(), this.sim.track);

    this.gfx.renderer.shadowMap.enabled = true;
    this.pipelines = this.slots.map((s) => new InkPipeline(gfx.renderer, this.scene, s.camera.camera, { noise: this.tex.noise, paper: this.tex.paper }));
    if (this.pipelines.length === 2) this.split = new SplitCompositor(gfx.renderer, this.pipelines);

    this.setTier(opts.tier);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.onResize();
  }

  private addSlot(index: number): void {
    const sources: InputSource[] = [];
    if (this.players === 1) {
      // Single player: every device controls the car (WASD and arrows both work).
      sources.push(new KeyboardSource('kb', mergeBindings(P1_KEYS, P2_KEYS)), new GamepadSource(0), this.opts.touch);
    } else {
      sources.push(new KeyboardSource(`kb-p${index + 1}`, index === 0 ? P1_KEYS : P2_KEYS), new GamepadSource(index));
    }
    const parent = worldUi();
    const tag = new VehicleTag(parent, index);
    const gauges = new PlayerGauges(parent, index);
    this.slots.push({ index, input: new PlayerInput(index, sources), camera: new FollowCamera(1), camYaw: 0, tag, gauges, banners: [] });
  }

  /** (Re)build the race: physics world, vehicles and their visuals. Racers 0..players-1 are humans. */
  startRace(): void {
    this.sim?.dispose();
    this.retired.clear();
    const entrants = this.setup.entrants;
    const specs: VehicleSpec[] = entrants.map((e) => (e.vehicle === 'tank' ? STEAM_TANK : HOT_ROD));
    this.sim = new RaceSim(
      this.trackFile,
      entrants.map((e, i) => ({ spec: specs[i]!, name: e.name, grid: this.setup.grid?.[i], tune: e.tune })),
      this.setup.seed + this.races++,
    );
    this.buildViews(specs);
    if (this.features) this.features.sim = this.sim;
    this.views.forEach((v, i) => {
      const e = entrants[i]!;
      v.driver = i >= this.players ? createDriver(i, this.sim.rules.rng.int(0, 1e9), ((i % 3) - 1) * 1.6, { skill: e.skill, catchUp: e.catchUp }) : null;
    });
    for (const s of this.slots) {
      s.camYaw = this.sim.racers[s.index]!.vehicle.heading();
      s.banners = [];
    }
    ui.results.value = null;
    this.loop.resetAccumulator();
    this.dynres.reset();
  }

  /**
   * Vehicle visuals and their emitters. Built once and kept across restarts: new rigs mean new
   * materials, and every new material is a shader compile, i.e. a frame hitch on the grid.
   */
  private buildViews(specs: VehicleSpec[]): void {
    if (this.views.length === specs.length && this.views.every((v, i) => v.spec === specs[i] && v.color === this.colorOf(i))) return;
    for (const v of this.views) {
      this.scene.remove(v.rig.root);
      for (const e of v.exhaust) e.enabled = false;
      v.dust.enabled = false;
      v.damage.enabled = false;
    }
    this.views = [];
    specs.forEach((spec, i) => {
      const color = this.colorOf(i);
      const rig = spec === HOT_ROD ? buildHotRod(this.tex, color) : buildSteamTank(this.tex, color);
      this.scene.add(rig.root);
      const exhaust = rig.stacks.map(() =>
        this.particles.addEmitter({ kind: 'smoke', rate: 0, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 2.5, z: 0 }, spread: 0.4, life: [1.2, 2.4], size: [0.8, 3.2] }),
      );
      const dust = this.particles.addEmitter({ kind: 'dust', rate: 0, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0.8, z: 0 }, spread: 1.2, life: [0.8, 1.6], size: [1, 3.5] });
      const damage = this.particles.addEmitter({ kind: 'smoke', rate: 0, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 3, z: 0 }, spread: 0.6, life: [1.5, 3], size: [1.2, 4.5] });
      this.views.push({ rig, spec, exhaust, dust, damage, fireAcc: 0, color, driver: null, scrapeAcc: 0 });
    });
  }

  /**
   * Compile every shader and upload every buffer/texture before the first frame (doc 03 §10.1).
   * The programs must be the ones the real frame uses: the MRT variants of the scene pass, the
   * shadow pass and the post chain. So: precompile through the scene pass, then render real frames.
   */
  async warmUp(): Promise<void> {
    const t0 = performance.now();
    // Objects outside the camera frustum are skipped: disable culling so every material of the
    // whole track compiles now instead of hitching the first time it comes into view.
    const culled: { frustumCulled: boolean }[] = [];
    this.scene.traverse((o) => {
      if (o.frustumCulled) {
        culled.push(o);
        o.frustumCulled = false;
      }
    });
    try {
      this.presentation(0, 0);
      this.particles.prime();
      for (const p of this.pipelines) await p.compileAsync();
      for (let i = 0; i < 2; i++) {
        this.render();
        // Not requestAnimationFrame: it never fires in a background tab and boot would hang.
        await new Promise((r) => setTimeout(r, 0));
      }
    } catch (e) {
      console.warn('[render] shader warm-up failed', e);
    }
    for (const o of culled) o.frustumCulled = true;
    // First HUD render (Preact mount of gauges and leaderboard) also belongs to loading.
    this.hudTimer = 1;
    this.updateHud(0);
    this.lastTime = -1;
    this.dynres.reset();
    console.info(`[render] warm-up (shaders, shadows, post) in ${Math.round(performance.now() - t0)} ms`);
  }

  private colorOf(i: number): string {
    return this.setup.entrants[i]?.color ?? IDENTITY_COLORS[i] ?? '#ffffff';
  }

  start(): void {
    this.gfx.renderer.setAnimationLoop(this.frame);
  }

  /**
   * Free the race: loop, listeners, physics, scene resources, render pipelines, DOM overlays.
   * The renderer, the canvas and the shared texture set stay for the next race.
   */
  dispose(): void {
    this.gfx.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisibility);
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    this.sim.dispose();
    for (const s of this.slots) {
      s.input.dispose();
      s.tag.dispose();
      s.gauges.dispose();
    }
    this.minimap?.dispose();
    this.split?.dispose();
    for (const p of this.pipelines) p.dispose();
    this.world.keyLight.shadow.map?.dispose();
    this.world.dispose();
    disposeScene(this.scene, sharedTextures(this.tex));
    ui.players.value = [];
    ui.standings.value = [];
    ui.results.value = null;
    ui.paused.value = false;
    ui.splitScreen.value = false;
  }

  /** Pause menu → Retire: every human still racing gives up (results right away). */
  retire(): void {
    for (const s of this.slots) {
      const r = this.sim.racers[s.index]!;
      if (r.finished) continue;
      this.retired.add(s.index);
      r.vehicle.wrecked = true;
      r.rules.hull.wreckedAt ??= this.sim.clock - tunables.get<number>('hull.wreckToResults');
    }
    this.setPaused(false);
  }

  /** Race outcome per racer (Cup): order now (AI still racing keep their running position). */
  outcomes(): RaceOutcome[] {
    const order = this.sim.standings();
    return this.sim.racers.map((r, i) => {
      const retired = r.vehicle.wrecked && !r.finished;
      return { position: order.indexOf(i) + 1, retired, wrecked: retired && !this.retired.has(i), bags: r.rules.money };
    });
  }

  setPaused(paused: boolean): void {
    if (this.loop.paused === paused) return;
    this.loop.paused = paused;
    this.loop.resetAccumulator();
    this.dynres.reset();
    ui.paused.value = paused;
    this.bus.emit('pauseChanged', { paused });
  }

  private setTier(name: QualityTierName): void {
    const tier = TIERS[name];
    this.dynres.setTier(tier);
    ui.tier.value = name;
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
    for (const p of this.pipelines) p.updateResolution();
    this.split?.resize();
    ui.renderScale.value = this.dynres.scale;
  }

  private onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.gfx.renderer.setSize(w, h, false);
    const split = this.slots.length === 2;
    for (const s of this.slots) s.camera.setAspect(split ? w / (h / 2) : w / h);
    for (const p of this.pipelines) p.updateResolution();
    this.split?.resize();
  };

  private onVisibility = () => {
    if (document.hidden) this.setPaused(true);
  };

  /** Enter on the results screen restarts (quick mode; the menus handle it otherwise). */
  private onKey = (e: KeyboardEvent) => {
    if (this.setup.mode === 'quick' && ui.results.value && (e.code === 'Enter' || e.code === 'NumpadEnter')) this.startRace();
  };

  /** One fixed simulation step: inputs/autopilots → RaceSim. */
  private simStep(): void {
    const sim = this.sim;
    const cmds: (ActionFrame | null)[] = [];
    for (let i = 0; i < sim.racers.length; i++) {
      const v = this.views[i]!;
      const slot = this.slots[i];
      if (slot) {
        const frame = slot.input.sample();
        if (frame.pressed.pause) {
          this.setPaused(true);
          return;
        }
        if (this.setup.mode === 'quick' && ui.results.value && (frame.pressed.steamPush || frame.pressed.reposition)) {
          // Steam push / reposition restarts from the results screen (pad and touch friendly).
          this.startRace();
          return;
        }
        const auto = tunables.get<boolean>('showcase.playerAutopilot');
        cmds.push(auto ? driveRacer((v.driver ??= createDriver(i, this.opts.flags.seed, 0)), sim) : frame);
      } else {
        cmds.push(driveRacer(v.driver!, sim));
      }
    }
    sim.step(cmds);
    for (const e of sim.drainEvents()) if (e.type === 'impact' && e.impact) this.onImpact(e.racer, e.impact);
    for (const e of sim.drainRuleEvents()) this.onRule(e);
    // Every human finished, or retired (after a few seconds) → results; AI keep racing behind.
    const wait = tunables.get<number>('hull.wreckToResults');
    const done = sim.racers.slice(0, this.players).every((r) => r.finished || (r.rules.hull.wreckedAt !== null && sim.clock - r.rules.hull.wreckedAt >= wait));
    if (!ui.results.value && done) this.showResults();
    this.bus.flush();
  }

  /** Feedback for every impact (edge hit, crash, scrape tick, other vehicles): sparks/dust + shake. */
  private onImpact(racer: number, hit: ImpactInfo): void {
    const t = (k: string) => tunables.get(k);
    const v = this.sim.racers[racer]!.vehicle.body.linvel();
    const sp = Math.hypot(v.x, v.z) || 1;
    const fx = hit.barricade ? EDGE_FX[hit.barricade] : { sparks: 1, dust: 0 };
    if (hit.kind !== 'scrape') {
      // Scrapes already emit continuously (presentation); impacts add a burst.
      const n = Math.min(60, hit.strength * t('feedback.sparkPerHit')) * (hit.kind === 'crash' ? 1.6 : 1);
      const gy = this.world.heightAt(hit.x, hit.z) + 0.25;
      if (fx.sparks > 0) this.sparks.burst(hit.x, gy + 0.8, hit.z, hit.nx, hit.nz, v.x / sp, v.z / sp, Math.round(n * fx.sparks), hit.kind === 'crash' ? 1.3 : 1);
      if (fx.dust > 0)
        this.particles.burst(
          { kind: 'dust', rate: 0, position: { x: hit.x, y: gy + 0.5, z: hit.z }, velocity: { x: hit.nx * 2, y: 1.6, z: hit.nz * 2 }, spread: 1.8, life: [0.6, 1.4], size: [1.2, 4] },
          Math.round(Math.min(24, n * 0.5) * fx.dust),
        );
    }
    const slot = this.slots[racer];
    if (!slot) return;
    if (hit.kind === 'crash') slot.camera.addShake(t('feedback.shakeCrash'));
    else if (hit.kind === 'hit') slot.camera.addShake(hit.strength * t('feedback.shakeHit'));
    else if (hit.kind === 'vehicle') slot.camera.addShake(hit.strength * t('feedback.shakeVehicle'));
  }

  /** Results table; refreshed while shown, since the AI keep racing. */
  private showResults(): void {
    const rows = this.sim.standings().map((i): ResultRow => {
      const r = this.sim.racers[i]!;
      return {
        index: i,
        bags: r.rules.money,
        name: r.name,
        color: this.views[i]!.color,
        time: r.progress.finishedAt,
        bestLap: r.progress.bestLap,
        isPlayer: i < this.players,
        retired: r.vehicle.wrecked && !r.finished,
        pf: r.rules.hull.pf,
      };
    });
    ui.results.value = this.setup.decorate ? this.setup.decorate(rows) : rows;
  }

  /** Short message over a player's viewport (gameplay.md §9.2 outcome banners). */
  private banner(racer: number, text: string, tone: Banner['tone']): void {
    const slot = this.slots[racer];
    if (!slot) return;
    slot.banners = [...slot.banners.filter((b) => b.text !== text), { id: this.bannerId++, text, tone, until: performance.now() + 1800 }].slice(-3);
  }

  /** Feedback for the rules layer: effects, shakes, banners. */
  private onRule(e: RuleEvent): void {
    const sim = this.sim;
    const t = (k: string) => tunables.get<number>(k);
    const gy = (x: number, z: number) => this.world.heightAt(x, z) + 0.25;
    const steam = (x: number, z: number, n: number, size: [number, number] = [1.5, 4.5]) =>
      this.particles.burst({ kind: 'steam', rate: 0, position: { x, y: gy(x, z) + 1.5, z }, velocity: { x: 0, y: 2.2, z: 0 }, spread: 2.2, life: [1, 2.4], size }, n);
    switch (e.type) {
      case 'start': {
        const r = sim.racers[e.racer]!;
        if (e.outcome === 'perfect') this.banner(e.racer, 'PERFECT START!', 'good');
        if (e.outcome === 'good') this.banner(e.racer, 'GOOD START', 'good');
        if (e.outcome === 'stall') this.banner(e.racer, 'STALLED!', 'bad');
        if (!r.rules.armed) this.banner(e.racer, `WEAPONS UNLOCK ON LAP ${t('weapons.unlockLap') + 1}`, 'info');
        if (e.outcome === 'perfect' || e.outcome === 'good') steam(r.vehicle.curr.x, r.vehicle.curr.z, e.outcome === 'perfect' ? 14 : 7);
        break;
      }
      case 'boilerTest':
        this.banner(e.racer, e.kind === 'burst' ? 'BOILER AT BURSTING POINT!' : 'RED ZONE: PRESSURE FULL', 'warn');
        break;
      case 'boiler': {
        const r = sim.racers[e.racer]!;
        const { x, z } = r.vehicle.curr;
        if (e.outcome === 'contained') this.banner(e.racer, 'PRESSURE CONTAINED', 'good');
        if (e.outcome === 'emergency') this.banner(e.racer, 'EMERGENCY VALVES: −3 GEARS', 'bad');
        if (e.outcome === 'valves') this.banner(e.racer, 'VALVES GAVE WAY', 'bad');
        steam(x, z, e.outcome === 'contained' ? 6 : 18, [2, 6]);
        if (e.outcome === 'explosion') {
          this.banner(e.racer, 'BOILER EXPLODED!', 'bad');
          this.particles.burst({ kind: 'smoke', rate: 0, position: { x, y: gy(x, z) + 1.5, z }, velocity: { x: 0, y: 4, z: 0 }, spread: 5, life: [1.5, 3.5], size: [3, 9] }, 30);
          this.sparks.burst(x, gy(x, z) + 1.5, z, 0, 0, 0, 0, 60, 1.6);
          const rad = t('boiler.shockRadius') * 2.5;
          for (const s of this.slots) {
            const p = sim.racers[s.index]!.vehicle.curr;
            const d = Math.hypot(p.x - x, p.z - z);
            if (d < rad) s.camera.addShake(t('feedback.shakeCrash') * (1 - d / rad) * 1.5);
          }
        } else this.slots[e.racer]?.camera.addShake(t('feedback.shakeCrash') * 0.4);
        break;
      }
      case 'armed':
        this.banner(e.racer, 'WEAPONS ARMED!', 'good');
        break;
      case 'vent':
        steam(e.x, e.z, 10, [2, 6]);
        break;
      case 'damage':
        if (e.source !== 'shot' && e.source !== 'boiler') this.banner(e.racer, `−${e.pf} PF`, 'dmg');
        break;
      case 'wreck': {
        const r = sim.racers[e.racer]!;
        this.banner(e.racer, 'WRECKED: RETIRED', 'bad');
        this.particles.burst({ kind: 'smoke', rate: 0, position: { x: r.vehicle.curr.x, y: r.vehicle.curr.y + 1, z: r.vehicle.curr.z }, velocity: { x: 0, y: 4, z: 0 }, spread: 3, life: [1.5, 3], size: [2, 7] }, 20);
        for (let i = 0; i < this.players; i++) if (i !== e.racer) this.banner(i, `${r.name.toUpperCase()} IS OUT`, 'info');
        break;
      }
      case 'ram': {
        this.sparks.burst(e.x, gy(e.x, e.z) + 0.9, e.z, 0, 0, 0, 0, 30, 1.2);
        for (const i of [e.a, e.b]) {
          this.slots[i]?.camera.addShake(t('feedback.shakeCrash') * 0.6);
          const won = (e.winner > 0 && i === e.a) || (e.winner < 0 && i === e.b);
          if (won) this.banner(i, 'RAM WON', 'good');
        }
        break;
      }
      case 'fire': {
        const dx = e.tx - e.x;
        const dz = e.tz - e.z;
        const len = Math.hypot(dx, dz) || 1;
        const ux = dx / len;
        const uz = dz / len;
        const y0 = gy(e.x, e.z);
        const y1 = gy(e.tx, e.tz);
        this.particles.burst({ kind: 'smoke', rate: 0, position: { x: e.x, y: y0 + 1.6, z: e.z }, velocity: { x: ux * 4, y: 1, z: uz * 4 }, spread: 0.8, life: [0.5, 1.2], size: [1, 3] }, 6);
        // Tracer: a line of sparks along the shell path.
        const n = Math.min(10, Math.ceil(len / 6));
        for (let k = 0; k <= n; k++) this.sparks.burst(e.x + dx * (k / n), y0 + (y1 - y0) * (k / n) + 1.5, e.z + dz * (k / n), 0, 0, -ux, -uz, k === 0 ? 8 : 2, k === 0 ? 1.4 : 0.8);
        if (e.blocked) this.sparks.burst(e.tx, y1 + 1.2, e.tz, -ux, -uz, ux, uz, 24, 1.1);
        else if (e.zone === 'miss')
          this.particles.burst({ kind: 'dust', rate: 0, position: { x: e.tx, y: y1 + 0.5, z: e.tz }, velocity: { x: 0, y: 2, z: 0 }, spread: 1.5, life: [0.6, 1.2], size: [1.5, 4] }, 6);
        if (e.blocked) this.banner(e.racer, 'BLOCKED BY THE BARRICADE', 'info');
        else if (e.target < 0) this.banner(e.racer, 'NO TARGET', 'info');
        this.slots[e.racer]?.camera.addShake(t('feedback.shakeHit') * 3);
        break;
      }
      case 'pylon':
        this.sparks.burst(e.x, gy(e.x, e.z) + 1, e.z, 0, 0, 0, 0, 14, 0.9);
        this.banner(e.racer, 'RUNE PYLON: -1 PV', 'warn');
        break;
      case 'pickup':
        if (e.kind === 'coal') {
          this.banner(e.racer, `COAL +${e.amount} PV`, 'good');
          this.sparks.burst(e.x, e.y + 1.3, e.z, 0, 0, 0, 0, 16, 0.8);
        } else {
          this.banner(e.racer, `+$${e.amount.toLocaleString('en-US')}`, 'good');
          this.sparks.burst(e.x, e.y + 1.3, e.z, 0, 0, 0, 0, 24, 1);
        }
        break;
      case 'landing': {
        if (e.clean) this.banner(e.racer, e.pv > 0 ? `CLEAN LANDING +${e.pv} PV` : 'CLEAN LANDING', 'good');
        else this.banner(e.racer, 'HARD LANDING: -1 GEAR', 'bad');
        const r = sim.racers[e.racer]!;
        this.particles.burst({ kind: 'dust', rate: 0, position: { x: r.vehicle.curr.x, y: r.vehicle.curr.y - 0.5, z: r.vehicle.curr.z }, velocity: { x: 0, y: 1.5, z: 0 }, spread: 3, life: [0.6, 1.4], size: [1.5, 4.5] }, e.clean ? 10 : 22);
        this.slots[e.racer]?.camera.addShake(t('feedback.shakeCrash') * (e.clean ? 0.25 : 0.6));
        break;
      }
      case 'hazard': {
        const name = { vent: 'FORGE VENT', crossing: 'TRAIN!', crane: 'SCRAP BLOCK', stream: 'SAP STREAM' }[e.kind];
        if (e.effect === 'crash') {
          this.banner(e.racer, `${name}: CRASH`, 'bad');
          this.slots[e.racer]?.camera.addShake(t('feedback.shakeCrash'));
        } else if (e.effect === 'damage' && e.amount > 0) this.slots[e.racer]?.camera.addShake(t('feedback.shakeCrash') * 0.5);
        else if (e.effect === 'steam' && e.kind !== 'stream') this.banner(e.racer, `${name}: +${e.amount} PV`, 'info');
        break;
      }
      case 'hit': {
        this.sparks.burst(e.x, gy(e.x, e.z) + 1.4, e.z, 0, 0, 0, 0, e.zone === 'edge' ? 10 : e.zone === 'body' ? 22 : 40, e.zone === 'centre' ? 1.5 : 1);
        const label = { centre: 'CENTRE HIT! −1 GEAR', vital: 'VITAL HIT', body: 'HIT', edge: 'GRAZED', miss: '' }[e.zone];
        if (label) this.banner(e.from, label, e.zone === 'edge' ? 'info' : 'good');
        if (e.zone !== 'edge') this.banner(e.racer, `SHOT: −${e.pf} PF`, 'dmg');
        this.slots[e.racer]?.camera.addShake(t('feedback.shakeCrash') * (e.zone === 'centre' ? 0.9 : 0.5));
        break;
      }
    }
  }

  private frame = (timeMs: number) => {
    const now = timeMs / 1000;
    const realDt = this.lastTime < 0 ? 1 / 60 : now - this.lastTime;
    this.lastTime = now;
    this.frames++;

    if (this.loop.paused) {
      for (const s of this.slots) if (s.input.sample().pressed.pause) this.setPaused(false);
    }
    const tick = this.loop.advance(realDt);
    for (let i = 0; i < tick.steps; i++) {
      this.simStep();
      if (this.loop.paused) break;
    }
    const simDt = this.loop.paused ? 0 : tick.frameDt * this.loop.timeScale;
    this.presentation(tick.alpha, simDt, tick.frameDt);
    this.render();
    this.updateTags();
    if (!this.loop.paused && this.dynres.update(realDt * 1000)) this.applyPixelRatio();
    this.updateHud(tick.frameDt);
  };

  /** Interpolate physics transforms onto the rigs, animate, update cameras and particles. */
  private presentation(alpha: number, simDt: number, frameDt = simDt): void {
    const sim = this.sim;
    const maxSpeed = tunables.get('handling.maxSpeed');
    sim.racers.forEach((r, i) => {
      const v = this.views[i]!;
      const a = r.vehicle.prev;
      const b = r.vehicle.curr;
      this.qa.set(a.qx, a.qy, a.qz, a.qw);
      this.qb.set(b.qx, b.qy, b.qz, b.qw);
      this.qa.slerp(this.qb, alpha);
      const root = v.rig.root;
      root.quaternion.copy(this.qa);
      // Visual root sits at ground contact: body centre minus the spec offset along the body up axis.
      this.tmp.set(0, -v.spec.visualOffsetY, 0).applyQuaternion(this.qa);
      root.position.set(a.x + (b.x - a.x) * alpha + this.tmp.x, a.y + (b.y - a.y) * alpha + this.tmp.y, a.z + (b.z - a.z) * alpha + this.tmp.z);
      const speed = r.vehicle.telemetry.forwardSpeed;
      for (const w of v.rig.wheels) w.rotation.x += (speed * simDt) / 0.9;
      v.rig.banner.rotation.x = Math.sin(sim.clock * 6 + i) * 0.05 * Math.min(1, Math.abs(speed) / 10);
      root.updateMatrixWorld();
      v.rig.stacks.forEach((s, k) => {
        const e = v.exhaust[k];
        if (!e) return;
        s.getWorldPosition(this.tmp);
        e.position.x = this.tmp.x;
        e.position.y = this.tmp.y;
        e.position.z = this.tmp.z;
        e.rate = 3 + Math.abs(speed) * tunables.get('showcase.smokePerSpeed') + (r.vehicle.lastOutput?.pushing ? 25 : 0);
      });
      // Dust from the rear when drifting or on loose surfaces.
      const loose = LOOSE_SURFACES.has(r.vehicle.telemetry.surface);
      v.dust.position.x = root.position.x;
      v.dust.position.y = root.position.y + 0.4;
      v.dust.position.z = root.position.z;
      v.dust.rate = r.vehicle.telemetry.drifting ? 30 : loose ? Math.abs(speed) * 1.2 : 0;

      // Hull condition (gameplay.md §6.1): smoke under 50 %, fire under 25 %, wreck smoulders.
      const cond = hullCondition(r.rules.hull);
      v.damage.position.x = root.position.x;
      v.damage.position.y = root.position.y + 2.2;
      v.damage.position.z = root.position.z;
      v.damage.rate = cond === 'wreck' ? 18 : cond === 'fire' ? 12 : cond === 'smoke' ? 5 : 0;
      if ((cond === 'fire' || cond === 'wreck') && simDt > 0) {
        v.fireAcc += (cond === 'wreck' ? 10 : 18) * simDt;
        const n = Math.floor(v.fireAcc);
        v.fireAcc -= n;
        if (n > 0) this.sparks.burst(root.position.x, root.position.y + 2, root.position.z, 0, 0, 0, 0, n, 0.35);
      }

      // Scraping a barricade: a continuous trail of sparks (or dust) from the contact point.
      const e = r.edge;
      const slide = Math.abs(e.slide);
      if (e.contact && slide > 1.5 && simDt > 0) {
        const fx = EDGE_FX[e.barricade];
        const frac = Math.min(1, slide / maxSpeed);
        v.scrapeAcc += tunables.get('feedback.sparkRate') * frac * simDt;
        const n = Math.floor(v.scrapeAcc);
        v.scrapeAcc -= n;
        if (n > 0) {
          const dir = Math.sign(e.slide);
          const smp = sim.track.samples[r.progress.index]!;
          if (fx.sparks > 0) this.sparks.burst(e.x, smp.y + 0.7, e.z, e.nx, e.nz, smp.tx * dir, smp.tz * dir, Math.round(n * fx.sparks), 0.5 + 0.5 * frac);
          if (fx.dust > 0)
            this.particles.burst(
              { kind: 'dust', rate: 0, position: { x: e.x, y: smp.y + 0.4, z: e.z }, velocity: { x: e.nx * 1.5, y: 1, z: e.nz * 1.5 }, spread: 1.2, life: [0.5, 1.1], size: [1, 3] },
              Math.round(n * 0.25 * fx.dust + 0.4),
            );
        }
        this.slots[i]?.camera.holdShake(tunables.get('feedback.shakeScrape') * frac);
      }
    });

    // Cameras: blend the track tangent with the vehicle heading (doc 03 §9) for a calm view.
    const followRival = tunables.get<string>('showcase.cameraTarget') === 'rival' && sim.racers.length > this.players;
    for (const s of this.slots) {
      const idx = followRival && s.index === 0 ? this.players : s.index;
      const r = sim.racers[idx]!;
      const root = this.views[idx]!.rig.root;
      const smp = sim.track.samples[r.progress.index]!;
      const trackYaw = Math.atan2(smp.tx, smp.tz);
      const heading = r.vehicle.heading();
      const blend = tunables.get('showcase.cameraTrackBlend');
      const target = heading + shortAngle(trackYaw - heading) * blend;
      s.camYaw = simDt > 0 ? dampAngle(s.camYaw, target, 0.25, frameDt) : target;
      // Height: the road under the car (smooth over jumps and crests), not the bouncing body.
      s.camera.update({ x: root.position.x, y: smp.y, z: root.position.z, heading: s.camYaw, speedFrac: Math.min(1, Math.abs(r.vehicle.telemetry.forwardSpeed) / maxSpeed) }, frameDt);
    }

    const cam = this.slots[0]!.camera.camera;
    const focus = this.views[0]!.rig.root.position;
    this.world.update(simDt, this.tmp.set(cam.position.x, focus.y, cam.position.z).lerp(focus, 0.7));
    this.features.update(simDt);
    this.particles.update(simDt, cam);
    this.sparks.update(simDt, cam);
  }

  private render(): void {
    const shadow = this.world.keyLight.shadow;
    const every = tunables.get<number>('quality.shadowEvery');
    shadow.autoUpdate = every <= 1;
    if (every > 1) shadow.needsUpdate = this.frames % every === 0;
    if (this.pipelines.length === 1) {
      this.pipelines[0]!.render();
      return;
    }
    // Split screen (PC, doc 03 §10.4): each player's full ink chain into its half (render/split.ts).
    this.split?.render();
  }

  /** Boiler readout for the steam pips (rules/boiler.ts). */
  private steamOf(g: GearboxState): SteamReadout {
    return { pv: g.boiler.pv, cal: boilerCal(g.boiler), regen: g.boiler.regen, usable: canPush(g) };
  }

  /** Page rectangle of a player's viewport (split: slot 0 is the top half). */
  private viewportOf(index: number): ViewportRect {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const split = this.slots.length === 2;
    const vh = split ? h / 2 : h;
    return { left: 0, top: split ? index * vh : 0, width: w, height: vh };
  }

  /** World point → page pixels in a player's viewport; null when behind the camera. */
  private toScreen(slot: PlayerSlot, x: number, y: number, z: number, vp: ViewportRect): { x: number; y: number } | null {
    const v = this.tmp2.set(x, y, z).project(slot.camera.camera);
    if (v.z > 1) return null;
    return { x: vp.left + (v.x * 0.5 + 0.5) * vp.width, y: vp.top + (-v.y * 0.5 + 0.5) * vp.height };
  }

  /** Centre prompts of one player (start test, boiler test, reticle, under fire). */
  private gaugeFrame(s: PlayerSlot, vp: ViewportRect): GaugeFrame | null {
    const sim = this.sim;
    const r = sim.racers[s.index]!;
    if (this.loop.paused || ui.loading.value || ui.results.value || r.vehicle.wrecked) return null;
    const rr = r.rules;
    const st = rr.start;
    const start =
      sim.phase === 'countdown' ? { needle: st.needle, lo: st.lo, hi: st.hi, tol: st.tol, red: tunables.get<number>('start.redLine') } : null;
    const bt = rr.boiler.test;
    const boiler = bt ? { needle: bt.needle, notch: bt.notch, half: bt.half, kind: bt.kind } : null;
    let reticle: GaugeFrame['reticle'] = null;
    const c = rr.cannon;
    if (c.target >= 0 && sim.phase !== 'countdown' && !r.finished) {
      const tr = this.views[c.target]!.rig.root.position;
      const tv = sim.racers[c.target]!.vehicle;
      const p = this.toScreen(s, tr.x, tr.y + 1.2, tr.z, vp);
      if (p) {
        const half = coneHalfAngle({
          shooterGear: r.vehicle.gearbox.gear,
          targetGear: tv.gearbox.gear,
          steer: Math.abs(r.vehicle.gearbox.steer),
          steady: c.steady,
          sinceManoeuvre: c.sinceManoeuvre,
          throughCloud: sim.rules.cloudBetween(r.vehicle.curr.x, r.vehicle.curr.z, tv.curr.x, tv.curr.z),
        });
        const dist = Math.hypot(tv.curr.x - r.vehicle.curr.x, tv.curr.z - r.vehicle.curr.z);
        const lateral = dist * Math.tan((half * Math.PI) / 180) + tunables.get<number>('weapons.cone.wobble') * 0.5;
        this.tmp.setFromMatrixColumn(s.camera.camera.matrixWorld, 0).multiplyScalar(lateral);
        const q = this.toScreen(s, tr.x + this.tmp.x, tr.y + 1.2 + this.tmp.y, tr.z + this.tmp.z, vp);
        reticle = { x: p.x, y: p.y, r: q ? Math.hypot(q.x - p.x, q.y - p.y) : 20, locked: isLocked(c) };
      }
    }
    // Under fire: a rival has locked this player.
    let underFire: number | null = null;
    const me = this.views[s.index]!.rig.root.position;
    const calm = sim.clock < tunables.get<number>('start.calmTime');
    for (const o of sim.racers) {
      if (calm || r.finished) break;
      if (o === r || o.vehicle.wrecked || !o.rules.armed || o.rules.cannon.target !== s.index || !isLocked(o.rules.cannon)) continue;
      const a = this.toScreen(s, me.x, me.y, me.z, vp);
      const op = o.vehicle.curr;
      const b = this.toScreen(s, op.x, me.y, op.z, vp);
      underFire = a && b ? Math.atan2(b.x - a.x, -(b.y - a.y)) : Math.PI;
      break;
    }
    return { vp, start, boiler, reticle, underFire };
  }

  /** Gear + steam pips pinned just behind (= below on screen) each player's vehicle; gauges; minimap. */
  private updateTags(): void {
    const back = tunables.get('hud.tagOffset');
    const followRival = tunables.get<string>('showcase.cameraTarget') === 'rival' && this.sim.racers.length > this.players;
    this.minimap?.update(
      this.sim.racers.map((r, i) => ({ x: r.vehicle.curr.x, z: r.vehicle.curr.z, color: this.views[i]!.color, player: i < this.players, wrecked: r.vehicle.wrecked })),
      !ui.loading.value,
    );
    for (const s of this.slots) {
      const vp = this.viewportOf(s.index);
      s.gauges.update(this.gaugeFrame(s, vp));
      const r = this.sim.racers[s.index]!;
      const root = this.views[s.index]!.rig.root;
      // Centred below the vehicle on screen whatever its heading: offset along the screen's down.
      const anchor = { x: root.position.x, y: root.position.y, z: root.position.z };
      const visible = !this.loop.paused && !(followRival && s.index === 0) && !ui.loading.value && !r.vehicle.wrecked && tunables.get<boolean>('hud.vehicleTag');
      s.tag.update(anchor, back, s.camera.camera, vp, r.vehicle.gearbox.gear, this.steamOf(r.vehicle.gearbox), visible);
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
    const sim = this.sim;
    const order = sim.standings();
    ui.phase.value = sim.phase;
    ui.countdown.value = sim.phase === 'countdown' ? Math.ceil(-sim.clock) : 0;
    ui.standings.value = order.map((i) => ({ name: sim.racers[i]!.name, color: this.views[i]!.color, isPlayer: i < this.players, retired: sim.racers[i]!.vehicle.wrecked && !sim.racers[i]!.finished }));
    if (ui.results.value) this.showResults();
    const now = performance.now();
    ui.players.value = this.slots.map((s) => {
      const r = sim.racers[s.index]!;
      const p = r.progress;
      const rr = r.rules;
      s.banners = s.banners.filter((b) => b.until > now);
      return {
        pf: rr.hull.pf,
        pfMax: rr.hull.max,
        condition: hullCondition(rr.hull),
        ammo: rr.cannon.ammo,
        cannonReady: rr.armed && rr.cannon.cooldown === 0 && rr.cannon.ammo > 0 && sim.clock >= tunables.get<number>('start.calmTime'),
        armed: rr.armed,
        unlockLap: tunables.get<number>('weapons.unlockLap'),
        boiler: { pv: rr.boiler.pv, cal: boilerCal(rr.boiler), pressure: rr.boiler.pressure, test: rr.boiler.test !== null },
        banners: s.banners,
        index: s.index,
        gear: r.vehicle.gearbox.gear,
        speedKmh: Math.round(Math.abs(r.vehicle.telemetry.forwardSpeed) * 3.6),
        pushReady: canPush(r.vehicle.gearbox),
        steam: this.steamOf(r.vehicle.gearbox),
        device: s.input.lastDevice,
        identityColor: this.views[s.index]!.color,
        lap: Math.min(sim.track.file.laps, p.lap + 1),
        laps: sim.track.file.laps,
        position: order.indexOf(s.index) + 1,
        racers: sim.racers.length,
        lapTime: sim.phase === 'countdown' ? 0 : p.finishedAt !== null ? (p.lastLap ?? 0) : sim.clock - p.lapStart,
        bestLap: p.bestLap,
        lastLap: p.lastLap,
        wrongWay: p.wrongWayTime > 1,
        finished: p.finishedAt !== null,
        money: rr.money,
      };
    });
  }

  /** Read-only snapshot for tests and the debug panel. */
  snapshot() {
    const sim = this.sim;
    return {
      backend: this.gfx.backend,
      tier: ui.tier.value,
      renderScale: this.dynres.scale,
      frames: this.frames,
      simSteps: this.loop.stepCount,
      paused: this.loop.paused,
      particles: this.particles.count,
      phase: sim.phase,
      clock: sim.clock,
      players: this.slots.map((s) => {
        const r = sim.racers[s.index]!;
        return {
          gear: r.vehicle.gearbox.gear,
          pushCooldown: r.vehicle.gearbox.pushCooldown,
          pv: r.vehicle.gearbox.boiler.pv,
          pf: r.rules.hull.pf,
          ammo: r.rules.cannon.ammo,
          armed: r.rules.armed,
          wrecked: r.vehicle.wrecked,
          start: r.rules.startOutcome,
          boilerTest: r.rules.boiler.test?.kind ?? null,
          speed: r.vehicle.telemetry.forwardSpeed,
          x: r.vehicle.curr.x,
          z: r.vehicle.curr.z,
          heading: r.vehicle.heading(),
          lap: r.progress.lap,
          distance: r.progress.distance,
          input: s.input.describe(),
          device: s.input.lastDevice,
        };
      }),
    };
  }
}

/** Layer for per-frame, world-anchored UI: below every #ui overlay (results, pause, loading). */
function worldUi(): HTMLElement {
  return document.getElementById('world-ui') ?? document.getElementById('ui') ?? document.body;
}

/** Textures of the shared procedural set (kept when a race's scene is disposed). */
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
