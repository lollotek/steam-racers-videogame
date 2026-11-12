# 03 — Engine Architecture

> Status: **v0.2** — A1–A5 decided (2026-11-12).
> Depends on: [00 — World & Lore](00-world-lore.md), [01 — Engine & Visual Direction](01-engine-visual-direction.md), [02 — Shader & Style Spec](02-shader-style-spec.md), [gameplay.md](gameplay.md) (gameplay reference).
> Purpose: define the code structure, runtime model and tooling so development can start.
> Key constraints from earlier decisions: Three.js `WebGPURenderer` + TSL with WebGL2 fallback (D3), rotating 3/4 camera (D2), mid-range 2021 phone at 30 fps (D4), **4–8 racers (default 4), 2-player split screen on PC only** (D5), foundry biome first (D6), **PWA only** (A4).

---

## 1. Architecture principles

1. **Simulation and rendering are separate.** Game logic runs at a fixed timestep on plain data; rendering reads that data and interpolates. Nothing in the simulation depends on frame rate or on Three.js objects.
2. **Deterministic-friendly simulation.** Fixed step, seeded random numbers, no `Math.random()` or wall-clock time in gameplay code. This enables ghosts/replays and keeps multiplayer possible later (D5).
3. **Data-driven content.** Vehicles, tracks, biomes and quality tiers are described in typed config files, not hard-coded.
4. **Zero allocations in the hot loop.** Object pools, preallocated vectors, instancing.
5. **Quality scales by configuration.** Every expensive feature is behind a quality-tier switch (doc 02 §14).
6. **Debuggable by default.** Every system exposes its parameters to the debug panel and has a debug draw.
7. **Simulation-first tooling.** Races must be runnable **headless** (no renderer, faster than real time) so balance and AI can be tested automatically (§15.2).
8. **Mobile performance first** (A2). The simulation is small and kept cheap; when a choice trades desktop fidelity against mobile frame time, mobile wins.
9. **Every player-facing system is per-player.** Input, camera, HUD and viewport are owned by a `PlayerSlot`, so 2-player split screen (PC) is not a retrofit.

---

## 2. Technology stack (confirmed)

| Area | Choice |
|---|---|
| Language | TypeScript (strict) |
| Build / dev server | Vite |
| Rendering | Three.js `WebGPURenderer` + TSL, WebGL2 fallback. Version pinned in `package.json`. |
| Physics | Rapier (`@dimforge/rapier3d-compat`), **main thread** (A2) |
| Distribution | **PWA** (A4): web app manifest + service worker (`vite-plugin-pwa`), installable, landscape |
| Entity model | Lightweight ECS: **miniplex** (typed, simple) |
| UI / HUD | **Preact + `@preact/signals`** in an HTML/CSS overlay separate from the canvas (A1). Only gauges that need per-frame updates bypass Preact (direct DOM/SVG writes). |
| Audio | Web Audio via `howler.js` (stub in the first milestones) |
| Input | Keyboard, Gamepad API, touch (`nipplejs` or custom) |
| Debug | `tweakpane`, `stats-gl` |
| Tests | Vitest (unit), Playwright (smoke/perf) |
| Lint / format | ESLint + Prettier |

---

## 3. Repository layout

```
steam-racers-videogame/
├─ docs/                     design documents (this folder)
├─ refs/                     visual references
├─ assets-src/               source art: .blend, .psd/.kra, stroke sprites (not shipped)
├─ public/assets/            processed runtime assets (GLB, KTX2, LUTs, audio)
├─ tools/
│  ├─ tam-generator/         procedural hatching TAM, paper, noise textures (doc 02 §4.1)
│  ├─ asset-pipeline/        gltf-transform scripts: compression, KTX2, validation
│  └─ sim/                   headless race runner (CLI) for balance/AI tests (§15.2)
├─ src/
│  ├─ main.ts                entry point
│  ├─ core/                  loop, time, events, rng, pools, math utils, config loader
│  ├─ ecs/                   world, component types, system registration
│  ├─ render/
│  │  ├─ renderer.ts         WebGPU/WebGL2 creation, resize, DPR
│  │  ├─ pipeline.ts         MRT pass + post chain (doc 02 §2)
│  │  ├─ materials/          InkLit lighting model, liquids, particles, cloth
│  │  ├─ post/               outline, paper/grain, composite nodes
│  │  └─ quality.ts          tiers + dynamic resolution
│  ├─ assets/                asset manager, manifests, loaders
│  ├─ physics/               Rapier world, collision groups, vehicle controller wrapper
│  ├─ vehicles/              vehicle definitions, sim model, visual rig
│  ├─ track/                 track data, spline sampling, progress, checkpoints
│  ├─ race/                  race state machine, laps, positions
│  ├─ rules/                 tabletop rules layer: gears, boiler, ramming, weapons, cards (gameplay.md)
│  ├─ editor/                block-based level editor (after M3, §7.3)
│  ├─ ai/                    racing line follower, avoidance, difficulty
│  ├─ camera/                3/4 rotating follow camera
│  ├─ fx/                    GPU particles, decals, trails, emitters
│  ├─ input/                 action mapping for keyboard/gamepad/touch
│  ├─ audio/                 sound manager (stub)
│  ├─ ui/                    HUD, menus, minimap, settings
│  ├─ game/                  top-level game states (boot, menu, loading, race, results)
│  └─ debug/                 tweakpane panels, debug views, debug draw
├─ tests/
└─ package.json, vite.config.ts, tsconfig.json
```

Rule: **`core/`, `track/`, `race/`, `rules/`, `ai/` and the vehicle sim never import Three.js renderer code.** They may use Three.js math types (`Vector3`, `Quaternion`) only.

---

## 4. Runtime overview

```
            ┌──────────── Game state machine (game/) ────────────┐
            │ Boot → Menu → Loading → Race → Results → Menu       │
            └────────────────────────┬───────────────────────────┘
                                     │
   Input ──► actions ──►  ┌──────────▼──────────┐
                          │  SIMULATION @60 Hz  │  fixed step
                          │  ai → vehicles →    │
                          │  physics → race     │
                          └──────────┬──────────┘
                                     │ snapshot (prev/curr state)
                          ┌──────────▼──────────┐
                          │  PRESENTATION       │  every frame
                          │  interpolate →      │
                          │  camera → fx →      │
                          │  render → HUD/audio │
                          └─────────────────────┘
```

### 4.1 Main loop

- Driven by `renderer.setAnimationLoop`.
- **Fixed simulation step: 1/60 s.** Accumulator pattern; max **4 substeps** per frame (avoid spiral of death); leftover time → interpolation alpha.
- Presentation interpolates transforms between the previous and current sim state with `alpha`, so a 30 fps phone and a 144 Hz monitor run the same simulation.
- `document.visibilitychange` → pause the game and clamp the accumulator.

```ts
// pseudo-code
onFrame(now) {
  const dt = min(now - last, 0.25); last = now;
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < MAX_STEPS) {
    input.sample(); sim.step(STEP); acc -= STEP; steps++;
  }
  const alpha = acc / STEP;
  presentation.update(dt, alpha);   // interpolation, camera, fx, animation
  renderPipeline.render();
  hud.update();
}
```

### 4.2 Simulation step order

1. **Input / AI** → write `DriveCommand` (throttle, brake, steer, fire, boost) per vehicle.
2. **Vehicle controllers** → apply forces/steering to Rapier bodies (arcade model, §6).
3. **Physics** → `world.step()`; read collision events.
4. **Track progress** → project each vehicle on the track spline; update distance along track, lap, checkpoint, wrong-way, off-track.
5. **Race rules** → positions, lap completion, finish, respawn of stuck/fallen vehicles.
6. **Gameplay events** → emitted to the event bus (collision, lap, position change, finish).

### 4.3 Presentation update order

1. Interpolate vehicle/object transforms.
2. Vehicle visual rig: wheel spin, suspension offset, track (caterpillar) UV scroll, cloth banners, smoke emitter rates.
3. Camera controller.
4. FX: emit from gameplay events, update GPU particles, decals, tyre/track marks.
5. Animated environment (gears, flicker presets — mostly shader time uniforms).
6. Render pipeline (doc 02 §2).
7. HUD (throttled to ~15 Hz for text, 60 Hz for gauges) and audio.

---

## 5. Core modules

### 5.1 `core/`

| Module | Responsibility |
|---|---|
| `Loop` | Fixed-step accumulator, pause, time scale (slow-mo debug). |
| `EventBus` | Typed pub/sub (`on<'lapCompleted'>`, `emit`). Sim events are queued and flushed after each step. |
| `Rng` | Seeded PRNG (e.g. `sfc32`/`mulberry32`); separate streams for gameplay, AI, cosmetic FX. |
| `Pool<T>` | Generic object pool. |
| `Config` | Loads and validates typed JSON configs (schema with `zod` or TS type guards). |

### 5.2 ECS (`ecs/`)

miniplex world; entities are plain objects with optional components:

| Component | Data |
|---|---|
| `transform` | position, rotation (current + previous for interpolation) |
| `rigidBody` | Rapier handle |
| `vehicle` | definition id, sim state (speed, rpm-like "steam pressure", health) |
| `driveCommand` | steer, steamPush (boost + gear up), gearDown (held: brake/reverse), vent, fireFront, fireRear, fireTurret, playCard[0..2], reposition — the actions of gameplay.md (Appendix) |
| `boiler` | steam points (PV), CAL, pressure, red-zone/reliability-test state (gameplay.md §5.2) |
| `hull` | hit points (PF, 20), RES, wreck flag (gameplay.md §6) |
| `racer` | racer index, identity (color, emblem — doc 02 §13.1), lap, checkpoint, progress, position |
| `aiDriver` | difficulty, target line offset, state |
| `playerControlled` | input device id |
| `view` | reference to the Three.js object / instance slot (presentation only) |
| `emitter` | particle emitter refs and rates |

Systems are plain functions `(world, dt) => void`, registered in an explicit order (§4.2, §4.3).

### 5.3 Event examples

`raceCountdown`, `raceStarted`, `checkpointPassed`, `lapCompleted`, `positionChanged`, `vehicleCollision {a, b, impulse, point}`, `vehicleRespawned`, `raceFinished`, `qualityTierChanged`.

---

## 6. Vehicles

### 6.1 Simulation model (arcade)

- Rapier dynamic rigid body (compound collider: chassis box + optional spike/blade colliders).
- **Rapier ray-cast vehicle controller** for suspension and grip. Tracked vehicles use 4–6 ray "wheels" per side; visuals animate the tracks.
- **Gear-based drive, no throttle** (gameplay.md §5.1): six gears, each a fraction of max speed (1st ≈ 1/5, 6th = max); the vehicle drives itself towards the target speed of the current gear. Steam push = short extra acceleration + gear up (costs 1 PV); gear down brakes; holding it brakes, then reverses.
- Arcade layer on top:
  - target speed from the current gear (+ push), extra drag off-track,
  - steering strength that decreases with speed,
  - lateral grip tuned per surface (metal plate, grate, dirt, oil, water),
  - anti-roll / auto-upright torque so vehicles rarely flip,
  - drift in corners (gameplay.md §5.1 rhythm: up on straights, down before corners, drift through).
- Rules (boiler, ramming, weapons, cards) are a **separate rules layer** (`src/rules/`) operating on component data, with all values in a single `rules` config (mirrors the tabletop groups `vehicles`, `boiler`, `start`, `weapons`, `modules`, `cards`, `barricades`, `grit`).
- All tuning values in data files; all are live-editable from the debug panel (§15).
- **Scope until M3: "simple gameplay"**: gears, steam push, boiler basics, collisions/hull, front cannon. Tournament (Grand Prix), garage/upgrades, modules, cards and advanced weapons come **after M3**.

### 6.2 Vehicle definition (data)

```jsonc
{
  "id": "foundry-hauler",
  "faction": "human-kingdom",
  "model": "vehicles/foundry-hauler.glb",
  "drive": "tracked",            // wheeled | tracked | halftrack
  "mass": 2400,
  "maxSpeed": 34,                // m/s, 6th gear
  "gearRatios": [0.2, 0.35, 0.5, 0.65, 0.82, 1.0],
  "accel": 14, "brake": 22,
  "table": { "CAL": 6, "AFF": 3, "RES": 1, "MAN": 2, "PF": 20 },
  "steer": { "low": 1.0, "high": 0.45 },
  "grip": { "plate": 1.0, "grate": 0.9, "dirt": 0.75, "oil": 0.35 },
  "health": 100,
  "rig": {
    "wheels": ["wheel_FL", "wheel_FR"],
    "tracks": ["track_L", "track_R"],
    "smokestacks": ["stack_0", "stack_1"],
    "banners": ["banner_0"],
    "runeMaterial": "mat_runes"
  }
}
```

### 6.3 Visual rig

GLB naming conventions (nodes found by name): `wheel_*`, `track_*` (UV-scrolled mesh), `stack_*` (smoke emitter sockets), `banner_*` (cloth with identity emblem), `muzzle_*` (weapon sockets), `light_*` (headlights). One material + one atlas per vehicle (doc 02 §6), plus identity uniforms.

---

## 7. Track

### 7.1 Data

Tracks are **assembled from blocks** in the level editor (§7.3) and saved as `tracks/<id>.track.json`. At load time the block layout is compiled into the runtime data below (the same data a hand-made track would provide):

| Field | Content |
|---|---|
| `centerline` | Closed Catmull-Rom spline (control points), sampled at load to ~1 m resolution with arc length table |
| `width` | Per-sample half-widths left/right |
| `surfaces` | Ranges / polygons → surface type (plate, grate, dirt, oil, water) |
| `checkpoints` | Indices along the spline; first = start/finish |
| `spawnGrid` | Up to 8 spawn transforms (D5: 4–8 racers) |
| `racingLines` | 1–3 AI lines (offset from centerline per sample) |
| `respawnPoints` | Derived from centerline |
| `cameraHints` | Optional per-range camera overrides (pitch/distance) |
| `minimap` | Simplified polyline for the HUD |

Each block GLB carries its visual mesh, a simplified **collision mesh** (`col_*` nodes), barrier colliders and **connector sockets** (`socket_in`, `socket_out`) that define the local centerline segment.

### 7.2 Progress & positions

- Each sim step: project vehicle position onto the sampled centerline (search near the last index → O(1)).
- `raceProgress = lap * trackLength + distanceAlongTrack` → sort for positions.
- Checkpoints prevent shortcuts; wrong-way detection from velocity vs tangent.

### 7.3 Block-based level editor (A3)

A simple grid editor in the spirit of block-based track builders: the user places track blocks on a grid; the surroundings are generated.

| Aspect | Design |
|---|---|
| **Grid** | Square grid, block size **16 × 16 m** (start value; to be checked against vehicle size and tabletop tile size). Height levels in steps of 4 m. Rotation in 90° steps. |
| **Block catalogue** | Straight, curve (small/large), S-curve, crossroads/jump-over, ramp up/down, jump, start/finish, pit/repair, surface variants (plate, grate, dirt, sand, oil, water ford), barricade type per edge (gameplay.md §6.3), pickup slots (coal, ammo, cards, money bag). |
| **Block definition** | GLB + JSON: footprint (cells), sockets (in/out position, direction, height), centerline segment, surface type, barricade edges, pickup slots, gameplay tags. |
| **Validation** | Closed loop, sockets matched, no overlaps, start/finish present, minimum length; shows errors on the grid. |
| **Generated surroundings** | Outside the track footprint, a **seeded generator** fills the space with biome set dressing: buildings, machinery, stands with crowds, smokestacks, debris, light sources, following rules per biome (density, distance from track, landmark slots). Same seed → same result. Editable seed + "reroll" button. |
| **Runtime** | The editor is a separate app entry (`/editor.html`) sharing the engine, renderer and asset manager. "Test drive" button launches the track in the game. |
| **Tabletop compatibility (secondary goal)** | The block grid maps 1:1 to **physical tiles**. Export targets later: printable top-down tile images (orthographic render per block, with bleed and cut marks) and track layout sheets; vehicle GLBs reusable for **miniatures** (watertight, scaled export for 3D print). Not in scope before M3, but block size and naming are chosen with this in mind. |

Editor implementation is scheduled **after M3** (M2/M3 use a hand-written test track JSON using the same block format).

---

## 8. AI

- **Follow a racing line** with look-ahead proportional to speed (pure pursuit), target speed from upcoming curvature.
- **Avoidance**: sample nearby racers (spatial hash) and shift lateral offset within track width.
- **Difficulty**: max speed scale, reaction delay, line accuracy; mild **rubber-banding** configurable per difficulty.
- **Recovery**: stuck/off-track detection → reverse or respawn.
- Weapons behaviour deferred to the gameplay doc; the AI writes the same `driveCommand` as the player (fire included).
- Uses its own RNG stream (deterministic).

---

## 9. Camera (D2)

| Parameter | Start value |
|---|---|
| FOV | 30° |
| Pitch | 52° |
| Distance | 80 m (→ 95 m at max speed); at FOV 30° this shows ~40–50 m of track vertically, as in the engine refs |
| Look-ahead | 0–12 m along velocity |
| Yaw follow | Follows the **track tangent** blended with vehicle heading (70/30), critically damped spring, half-life ~0.35 s |
| Collision | None needed (high camera); occluders near camera fade via dithering |
| Shake | Trauma-based (impulse → trauma, decays), max 0.4 m / 1.5° |

Following the track tangent rather than the raw vehicle heading keeps the view calm during slides and spins. Camera hints from the track can override pitch/distance per section.

---

## 10. Rendering subsystem

### 10.1 Renderer bootstrap

1. `new WebGPURenderer({ antialias: false })` → `await renderer.init()`; Three.js falls back to WebGL2 automatically when WebGPU is unavailable. Log the active backend.
2. DPR capped: mobile 2.0 × render scale; desktop 1.0–2.0.
3. Build the pipeline from doc 02 (MRT pass, outline, bloom, grade, AA) according to the quality tier.
4. **Shader warm-up**: `renderer.compileAsync(scene, camera)` during the loading screen to avoid first-frame hitches.

### 10.2 Quality manager

- **Initial tier** from: backend (WebGPU/WebGL2), `navigator.hardwareConcurrency`, device memory hint, screen size, mobile UA, and a **2-second benchmark** on first launch (stored in `localStorage`).
- **Dynamic resolution**: rolling average frame time; if above budget for 1 s → lower render scale by 0.05 (min tier bound); if below 80% of budget for 3 s → raise. Never changes features mid-race, only resolution.
- Player can override tier and individual options (line wobble Off/Low, particles, shadows).
- Emits `qualityTierChanged`; systems rebuild what they need between races.

### 10.3 Draw call strategy

- Environment props: `InstancedMesh` per prop type (casings, tyres, spikes, barrels) or `BatchedMesh` for varied static props sharing the biome atlas.
- Static environment merged per chunk (~30×30 m) for culling.
- Crowds: instanced with vertex-animation or sprite sheets.
- Lights: tiled lighting on WebGPU High/Ultra; nearest-N selection otherwise (doc 02 §3.4).

### 10.4 Split screen (PC only, D5)

- Two `PlayerSlot`s → two cameras, rendered as **two viewports** (horizontal split, 16:9 → two 16:4.5 halves, or vertical on ultrawide) with scissor.
- The post chain runs per viewport (render targets sized to each half), so the pixel cost stays close to single-player; draw calls roughly double. Split screen forces at most the **High** tier with reduced particles.
- Disabled on touch devices / mobile UA.

---

## 11. Assets

### 11.1 Asset manager

- Loaders: `GLTFLoader` + `KTX2Loader` (Basis transcoder) + `MeshoptDecoder`, LUT loader, JSON configs.
- **Manifest per level** (`levels/foundry-01.manifest.json`): list of assets + byte sizes → accurate progress bar.
- Reference counting; unload level assets on level change (`dispose()` geometries, materials, textures).
- Shared assets (vehicles, particle atlas, UI) stay resident.

### 11.2 Pipeline (`tools/asset-pipeline`)

```
assets-src/*.blend ──Blender export──► raw .glb
raw .glb ──gltf-transform──► dedup, prune, weld, instance, meshopt, KTX2 (UASTC/ETC1S) ──► public/assets/
```

- Validation script: triangle counts, texture sizes, material count, node naming conventions (§6.3, §7.1) against budgets in doc 01 §5.
- Per-tier texture variants (`_1k`, `_2k`) chosen at load time.

### 11.3 Memory budgets

| | Mobile | Desktop |
|---|---|---|
| GPU textures (resident) | ≤ 300 MB | ≤ 1 GB |
| Download for first race | ≤ 40 MB | ≤ 80 MB |

iOS Safari tabs are killed above ~1–1.5 GB total; budget conservatively.

---

## 12. Input

- **Actions**, not keys (gameplay.md Appendix): `steer` (−1..1), `steamPush`, `gearDown` (held = brake/reverse), `vent`, `fireFront`, `fireRear`, `fireTurret`, `card1..3`, `reposition`, `pause`.
- Default bindings:

| Action | P1 keyboard | P2 keyboard (split screen) | Gamepad |
|---|---|---|---|
| Steer | ← → | A D | Left stick |
| Steam push / gear up | ↑ | W | A |
| Gear down (hold: brake, reverse) | ↓ | S | LT |
| Vent / boiler test / defence | Right Shift | Left Shift | B |
| Front weapon | Right Ctrl / `.` | X | RB |
| Rear weapon | End | Z | LB |
| Turret | Delete | V | Y |
| Cards 1/2/3 | Insert / Home / PageUp | 1 / 2 / 3 | D-pad ↑ / ← / → |
| Reposition | Backspace / R | E | Back (hold) |
| Pause | Esc / P | — | Start |

- **Touch layout** (gameplay.md Appendix): left steering pad, big steam-push button, "Gear −" pedal (hold = brake), buttons for vent, weapons and cards. Layout scales with screen size and safe areas; landscape only; optional haptics (`navigator.vibrate`) on impacts.
- **Per-player devices**: each `PlayerSlot` owns one input source (keyboard set P1/P2, a specific gamepad index, or touch).
- Input sampled once per sim step; sim reads only `DriveCommand`. Input recording/replay for tests (§16).

---

## 13. UI & HUD

- **Preact** app in an HTML/CSS overlay above the canvas (A1); CSS uses the biome palette tokens (doc 02 §12).
- HUD layout follows gameplay.md §9.2: top-left position/lap + strip with hull (PF), weapons/ammo/grit, boiler gauge (0 → 2 × CAL, right half red), money, brass gear plate; top-right minimap + leaderboard (compact on phones) with racer identity colors/emblems; card hand above the speedometer; centre prompts (start test, crosshair, "under fire" warning, outcome banners).
- Gauges drawn with SVG, updated at 60 Hz by direct DOM writes; text through signals, throttled.
- **Split screen**: one HUD instance per `PlayerSlot`, positioned over its viewport.
- Safe-area insets for phones (`env(safe-area-inset-*)`).
- Menus: main, track/vehicle select, settings (quality, controls, audio, line wobble), pause, results.

---

## 14. Game states

| State | Responsibilities |
|---|---|
| `Boot` | Detect backend/tier, load shared assets, warm-up |
| `Menu` | UI only (3D background scene optional, low cost) |
| `Loading` | Load level manifest, build scene, compile shaders, spawn racers |
| `Race.Countdown` | Sim running, inputs locked, camera intro |
| `Race.Running` | Full loop |
| `Race.Paused` | Sim paused, render a static frame, pause menu |
| `Race.Finished` | Player finished; AI continue for a few seconds, then results |
| `Results` | Times, positions, retry / next |

---

## 15. Debug tooling

### 15.1 Tuning panel (human tests)

- Opened with the **`?debug` query parameter** (also in production builds; hidden otherwise, never loaded without the flag → no cost for players).
- **Every parameter that affects gameplay or rendering** is registered in a central `Tunables` registry (name, group, default, range, unit) and shown in the panel automatically:
  rendering (all doc 02 parameters), debug views (doc 02 §15), camera, vehicle handling, gears, boiler, collisions, AI, quality tier, time scale.
- Panel features: live edit, **reset to default**, **save/load presets** (`localStorage`), **export/import JSON** (to share tuning results), copy current values as config.
- Usable on phones: collapsible, touch-friendly, can be docked/minimised so the touch controls stay usable.

### 15.2 Simulation tooling (automated tests)

- The simulation runs without the renderer (`core`, `physics`, `track`, `race`, `ai`, `rules` have no rendering imports, §3).
- **Headless runner** `tools/sim` (Node CLI): runs N races AI-vs-AI (or recorded inputs) faster than real time with a given seed, track, vehicles and tunables preset; outputs JSON/CSV statistics (lap times, positions, collisions, boiler explosions, steam usage, stuck/respawn counts).
- Used for balance checks, AI regression, determinism checks and in CI.
- In the browser: `?sim=fast` runs the same simulation at max speed with optional rendering.

### 15.3 Other debug features

- **Debug draw**: spline + checkpoints, racing lines, AI targets, physics colliders (Rapier debug render), vehicle forces, light radii.
- **Stats**: `stats-gl` (FPS, CPU/GPU ms), draw calls, triangles, texture memory; overlay of active input device and touches.
- **URL flags**: `?debug`, `?tier=low`, `?track=foundry-01`, `?seed=123`, `?racers=4`, `?players=2`, `?backend=webgl2` (force fallback), `?touch=1` (force touch UI on desktop).
- Live-reload of config JSON in dev.

---

## 16. Testing & performance

| Type | What |
|---|---|
| Unit (Vitest) | Spline sampling & progress, lap/position logic, RNG, pools, input mapping, config validation |
| Determinism test | Same seed + recorded inputs → same final positions/times after N steps |
| Headless sim | `tools/sim` races with fixed seeds: no stuck vehicles, all finish, stats within expected ranges |
| Smoke (Playwright) | **Desktop and mobile projects** (desktop Chrome + emulated phone with touch): app boots on WebGPU and forced WebGL2, a race starts and runs 10 s without errors |
| Controls (Playwright) | Keyboard actions (P1 and P2 sets), touch controls (tap/hold/drag on the virtual pad), gamepad via a mocked `navigator.getGamepads` |
| Performance | Scripted camera fly-through capture: avg/p95 frame time per tier; run on reference devices (desktop mid GPU, mid-range 2021 phone) |
| Manual test checklist | Per milestone, on PC (keyboard + gamepad) and on a real phone (touch), using the `?debug` panel |

---

## 17. Build & deploy

- `vite build` → static files; deploy to any static host/CDN.
- Hashed file names for code; versioned asset folder for cache busting.
- HTTPS required (WebGPU needs a secure context).
- **PWA** (A4): manifest (name, icons, `display: fullscreen`, `orientation: landscape`), service worker caching code and assets for offline play, update prompt when a new version is available. No other distribution targets for now.

---

## 18. Milestones

| Milestone | Content | Exit criteria |
|---|---|---|
| **M0 — Setup** | Repo, Vite/TS, lint, renderer bootstrap with backend detection, fixed-step loop, seeded RNG, event bus, `Tunables` + `?debug` panel, input actions (keyboard P1/P2, gamepad, touch), asset manager skeleton, PWA manifest, unit + smoke tests (desktop + mobile) | Test scene on WebGPU and WebGL2, desktop + phone; input actions visible in debug panel from all devices |
| **M1 — Look test** | `InkLit`, hatching (procedural TAM), outlines, bloom, LUT, fog, steam particles, one foundry track section, 2 placeholder vehicles (static/animated), camera | Doc 02 §16 acceptance criteria |
| **M2 — Driving prototype** | Rapier, gear-based vehicle model, steam push, input (kbd/gamepad/touch), camera follow, block-format test track, progress, laps, headless runner | Fun to drive 3 laps alone on desktop and phone |
| **M3 — Race vertical slice** | 4 racers (configurable up to 8) with AI, start test, boiler basics, hull/collisions, front cannon, race states, HUD, minimap, identity banners/runes, results, 2-player split screen on PC | Complete 3-lap race vs 3 AI at target FPS on both device classes |

After M3: Grand Prix and economy, garage/upgrades, modules, full arsenal, cards and race events, driving school, level editor (§7.3), more biomes, audio and menu polish.

---

## 19. Open points

| ID | Question | Status |
|---|---|---|
| A1 | UI layer | ✅ **Decided (2026-11-12):** separate DOM overlay with Preact + signals. |
| A2 | Physics threading | ✅ **Decided (2026-11-12):** main thread, simulation kept minimal; mobile performance is the priority. |
| A3 | Track authoring | ✅ **Decided (2026-11-12):** block-based grid editor + generated surroundings, compatible with tabletop tiles/miniatures (§7.3); after M3. |
| A4 | Distribution | ✅ **Decided (2026-11-12):** PWA only. |
| A5 | Gameplay reference | ✅ **Decided (2026-11-12):** [gameplay.md](gameplay.md); simple gameplay up to M3, advanced systems after. |
| A6 | Block size vs tabletop tile size and vehicle scale | Open — check during M2. |
| A7 | Gameplay values (`rules` groups referenced in gameplay.md: gear speeds, PV costs, boiler timings, damage) | Open — ask the owner when the related features are implemented. |
