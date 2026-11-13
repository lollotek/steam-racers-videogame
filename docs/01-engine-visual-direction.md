# 01 — Engine & Visual Direction

> Status: **v1.0** — analysis of `/refs`, technical proposal. All open decisions (D1–D6) resolved.
> Scope: rendering engine, visual style, effects, technical stack, asset pipeline.
> Out of scope (later docs): gameplay design, vehicle handling tuning, netcode, audio, UI flow.

---

## 1. Reference analysis

### 1.1 `refs/engine` — target in-game look (6 images)

These are mock-up "screenshots" of the final game and are the **primary target** for the engine.

| Aspect | Observation |
|---|---|
| **Camera** | High 3/4 top-down view (pitch ~45–60°), slightly isometric. Narrow perspective (little visible foreshortening). Camera follows the pack and sees ~40–80 m of track. Ref 4 has a lower, more cinematic angle (~30°). |
| **Rendering style** | Hand-drawn **comic/ink illustration**: thick dark outlines on all silhouettes, thinner interior ink lines (rivets, plate seams, grates), **hatching / cross-hatching** in shadowed areas, painted grime and rust on textures. |
| **Palette** | Desaturated browns, rust, dark iron and soot as the base (~80% of the screen). Two accent families: **warm emissive** (furnaces, fire, molten pools: orange/yellow) and **cool neon** (runes, faction signs: cyan, magenta, green, red). |
| **Lighting** | Low ambient, moody. Many local warm light sources (furnaces, braziers, lava) that pool light on the ground. Neon signs glow with bloom. No strong sun; overall light is diffuse/overcast. |
| **Atmosphere** | Heavy **volumetric-looking smoke and steam** (white steam from vents, black exhaust from vehicles), low fog layers at screen edges, dark vignette. |
| **Track surface** | Riveted metal plates, metal grates, dirt and grass sections, oil stains, puddles. Barriers: spiked wooden/iron fences, tyre walls, metal rails, concrete blocks. |
| **Set dressing** | Very dense: shell casings scattered on the track, scrap, tools, bones, barrels, tyres, billboards, banners, skulls, spikes, pipes, boilers. |
| **Life** | Crowds of spectators on stands/catwalks (ref 4, 5, 6), smokestacks, furnaces with animated fire, bubbling liquid pools (water ref 1, lava ref 3/5). |
| **Gameplay hints** | Combat racing: vehicles with cannons, machine guns, rams; muzzle flashes; up to 12 racers. |
| **HUD** | Position (x/12), lap (x/3), best/current lap timer, mini-leaderboard, minimap with racer dots, circular gauges (health, fuel, tyres/"steam pressure"), weapon slots. Decorated with gears/brass in some variants. |

### 1.2 `refs/vehicles` — vehicle design (6 images)

| Aspect | Observation |
|---|---|
| **Archetypes** | Heavy steam tanks with tracks, half-tracks (wheels front, tracks rear), bulldozer-blade tanks, locomotive-like machines, lighter "carriage" vehicles on big spoked wheels. From the engine refs also: hot rods, pickups, trucks, sports cars. |
| **Faction language** | **Dwarven**: dark iron + gold, engraved runes glowing orange/blue, bearded faces as ornaments. **Human kingdom**: riveted steel/copper, heraldic lion banners, bulldozer blades. **Brutish/raider**: rusty scrap, spikes, jaw-shaped rams, crude paint. **Elven**: polished copper/wood, Celtic knotwork, crystal cannon, glowing cyan runes. |
| **Recurring elements** | Smokestacks/chimneys (→ emit smoke!), boilers, exposed pipes, gauges, gears, turrets, rivets, banners, emissive parts (runes, furnace grilles, headlights). |
| **Proportions** | Chunky, top-heavy, oversized wheels/tracks and guns: good for readability at a distance. |
| **Detail level** | Concept art is very detailed (painterly-realistic). In-game a vehicle will cover ~80–200 px on screen, so detail must be **simplified into silhouette + painted texture + ink lines**, not modelled. |

### 1.3 `refs/world` — environment inspiration (4 images)

Four biome/faction themes:

1. **Dwarven hall** — huge stone pillars, gothic vaults, giant gears, glowing runes, holographic rune-tech displays, cold blue light + hot red/orange energy.
2. **Steampunk Victorian city** — brick and iron architecture, smokestacks, gas lamps, wet cobblestone with reflections, rail tracks, airships, bunting, warm amber light under grey skies.
3. **Scrap/raider desert city** — towers of corrugated metal, horns and spikes, giant statues, red/green neon signs, cranes, dust haze, desert backdrop.
4. **Elven forest city** — giant glowing trees, organic towers, flowing cyan/green rune signs, rain, misty mountains, wet reflective walkways.

Common denominator: **"rune-tech"**: ancient/fantasy materials (stone, wood, brass) combined with glowing neon-like runes and steam machinery. This ties all biomes together and gives the engine a consistent emissive + bloom requirement.

### 1.4 Style tension to resolve

The `engine` refs are **ink-and-hatching comic illustrations**; the `vehicles` and `world` refs are **painterly semi-realistic concept art**. The engine can't fully deliver both. **Decided (D1):**

> **The `engine` refs define the rendering style. `vehicles` and `world` define content, shapes, materials and color themes**, translated into the comic style.

(See Open Decision D1.)

### 1.5 IP note

Some references lean very close to existing franchises (e.g. the "WAAAGH!" ork vehicle in `ref-vehicle (2)` and the ork city in `world (3)` are recognisably Warhammer 40k-style). Use them for mood only; final faction names, iconography, slogans and silhouettes must be original.

---

## 2. Visual pillars (what the engine must deliver)

1. **Living illustration**: every frame should look like an inked comic panel: outlines, hatching, painted textures, paper grain.
2. **Dark rust, hot light**: a dim, desaturated base world punctuated by fire and neon. Contrast is what makes it readable.
3. **Thick atmosphere**: smoke, steam, haze and floating particles are always present.
4. **Readable chaos**: dense set dressing and effects, but vehicles, track edges, hazards and pickups must always read instantly (top-down racing is unforgiving).
5. **Scales from phone to PC**: same style on all devices; only density and resolution change.

---

## 3. Rendering features

Priority: **P0** = needed for the first vertical slice, **P1** = needed for the look, **P2** = polish.

### 3.1 Stylized shading

| Feature | Prio | Notes |
|---|---|---|
| Custom toon/"ink" lit material | P0 | Soft 3–4 band light ramp (not hard cel), driven by a ramp texture per biome. Albedo carries most of the painted look. |
| Hatching in shadow areas | P1 | Tonal Art Map (TAM): 3–4 hatching textures with increasing density, blended by light intensity. Applied in **screen space or triplanar** to avoid UV issues. Cross-hatching for darkest tones. Hatch lines tinted dark brown, not pure black. |
| Painted texture approach | P0 | Hand-painted albedo with baked grime, rust, edge wear and **baked ink lines** for small details (rivets, seams, bolts), i.e. the "texture-line" technique. Keeps geometry low. |
| Emissive materials | P0 | Runes, furnace mouths, neon signs, headlights, lava. HDR values > 1 to drive bloom. Animated flicker/pulse via shader uniforms. |
| Rim/edge highlight | P2 | Subtle rim light on vehicles to separate them from the dark ground. |

### 3.2 Outlines

| Feature | Prio | Notes |
|---|---|---|
| Screen-space edge detection | P0 | Post-process Sobel on **depth + normals (+ object/material ID)** buffer. Gives silhouette + crease lines on everything at a fixed cost. Thickness scales with resolution. |
| Line "wobble" | P1 | Distort edge sampling with a static low-frequency noise texture for a hand-drawn feel. No animated "boiling lines" (decided in doc 02, S2). Player option Off/Low. |
| Inverted-hull outline for vehicles | P2 | Extra thick, clean silhouette on racers for readability. Only if the screen-space pass isn't enough. |

### 3.3 Lighting & shadows

| Feature | Prio | Notes |
|---|---|---|
| One directional key light + hemisphere ambient | P0 | Moody overcast light, colored per biome. |
| Shadow map for the key light | P0 | Camera is top-down and close, so a **single shadow map fitted to the camera frustum** is enough (no full cascades). Mobile low tier: blob shadows under vehicles. |
| Many local point lights | P1 | Furnaces, braziers, lava, neon. Options: **tiled/clustered lighting** (WebGPU path), or **baked lightmaps/vertex colors** for static lights + max 4–8 dynamic lights near the camera. Cheap trick: additive "light pool" decals on the ground. |
| Baked ambient occlusion | P1 | Baked into textures/vertex colors in Blender. Optional SSAO/GTAO only on high tier. |

### 3.4 Atmosphere & effects

| Feature | Prio | Notes |
|---|---|---|
| Height + distance fog | P0 | Fog colored per biome; hides the world edges. |
| Smoke/steam particles | P0 | Soft billboard particles with **stylized flipbook textures** (ink-outlined puffs). White steam from vents, black exhaust from vehicle stacks, dust from tracks. Soft-particle depth fade. |
| Fire, sparks, embers | P1 | Furnaces, collisions, grinding, weapons. Embers floating in the air over the whole level. |
| Weapons VFX | P1 | Muzzle flash, tracers, projectiles, explosions with shockwave, debris and scorch decals. |
| Shell casings & debris | P1 | Instanced meshes, simple physics or scripted bounce, pooled. |
| Decals | P1 | Oil stains, scorch marks, tyre/track marks (dynamic trail meshes). |
| Liquid pools | P1 | Stylized water/lava/toxic sludge shader: scrolling flowmaps, ripple rings, emissive for lava, steam above. |
| Animated props | P2 | Rotating gears, pistons, flickering neon, waving banners (vertex shader). |
| Crowds | P2 | Instanced low-poly or billboard spectators, animated via vertex animation textures (VAT) or 2–4 frame sprite sheets. |
| Weather | P2 | Rain (elven/Victorian biomes), dust storm (desert), wet-surface reflections faked with screen-space or planar tricks on high tier only. |

### 3.5 Post-processing stack (in order)

1. Outline pass (depth/normal/ID edges)
2. Hatching composite (if done in screen space)
3. Bloom (threshold-based, emissive only; mobile: half-res)
4. Color grading via **3D LUT** per biome (warm, desaturated, crushed blacks)
5. Vignette + **paper grain/noise overlay**
6. Anti-aliasing: FXAA/SMAA (MSAA conflicts with some post passes)
7. Optional: chromatic aberration/screen shake on impacts (P2)

### 3.6 Camera

- Perspective camera with **low FOV (~25–35°)** placed high and far: near-isometric look while keeping depth cues and correct shadows/fog.
- Follows the player with look-ahead in the direction of travel, smooth damping, slight zoom-out at high speed.
- Rotation: **rotates with the track/player heading** (D2), with heavy damping so the view stays stable in curves.
- Screen shake on impacts/explosions.

---

## 4. Proposed technical stack

| Area | Proposal | Why |
|---|---|---|
| Language/build | **TypeScript + Vite** | Fast dev server, simple production builds, typed code base. |
| Renderer | **Three.js `WebGPURenderer` + TSL** (node materials), automatic WebGL2 fallback | One shader codebase (TSL compiles to WGSL and GLSL). Custom toon/hatching/outline shaders and post-processing are written once. WebGPU is now available on desktop Chrome/Edge/Safari/Firefox and on iOS/Android browsers; WebGL2 covers the rest. See D3. |
| Alternative renderer | `WebGLRenderer` + `postprocessing` (pmndrs) | More mature ecosystem and examples, but no compute shaders and the code is harder to move to WebGPU later. |
| Physics | **Rapier** (`@dimforge/rapier3d-compat`, WASM) | Fast, deterministic, has a ray-cast vehicle controller. Arcade handling on top of it (custom forces), not a simulation. |
| Game architecture | Vanilla Three.js scene + fixed-timestep loop; lightweight ECS (`miniplex` or `bitecs`) optional | Avoid React-Three-Fiber: a racing game needs tight control of the frame loop. |
| Particles | Custom GPU instanced particles (TSL compute on WebGPU) | Smoke/steam/sparks are a core visual; better owned than borrowed. `three.quarks` is an option on the WebGL path. |
| Input | Keyboard, Gamepad API, touch (virtual stick + buttons, e.g. `nipplejs`) | PC + mobile. |
| Audio | Web Audio (`howler.js` for convenience) | Out of scope here. |
| HUD/UI | HTML/CSS overlay on top of the canvas | Easier to style (steampunk frames, fonts), responsive, accessible. Minimap drawn from the track spline. |
| Debug tooling | `tweakpane` or `lil-gui`, `stats-gl`, Three.js inspector | Live tuning of shaders, lights, fog, physics. |

---

## 5. Asset pipeline

| Step | Tool / format |
|---|---|
| Modelling | **Blender** (low/mid-poly, chunky shapes). Modular **track kit** (straights, curves, ramps, barriers) + prop library per biome. |
| Texturing | Hand-painted albedo (Blender texture paint, Substance Painter, or Krita/Photoshop over baked AO/curvature). **Trim sheets & atlases** to keep draw calls down. Ink detail lines painted into textures. |
| Export | **glTF 2.0 / GLB** |
| Optimization | `gltf-transform` CLI: **Meshopt or Draco** geometry compression, **KTX2 (Basis Universal)** textures, instancing, resizing per quality tier. |
| Track authoring | Spline in Blender (or in-engine editor later) → generates road mesh, barriers, racing line, checkpoints, AI waypoints, minimap. |
| Lighting bake | AO and static light baked to vertex colors or a lightmap UV channel. |

### Suggested budgets (to validate in prototype)

| | Mobile (mid-range 2021, D4) | Desktop |
|---|---|---|
| Target FPS | 30 stable (60 on high-end) | 60+ |
| Render resolution | 0.6–0.8× with dynamic resolution | 1.0× (up to 1440p) |
| Draw calls | < 150 | < 500 |
| Triangles on screen | ~300k | ~1.5M |
| Racer vehicle | 3–6k tris, 1 material, 1024² atlas | 8–15k tris, 2048² |
| Dynamic lights | 2–4 | 16+ (tiled) |
| Active particles | ~2k | ~20k |

### Quality tiers

**Low / Medium / High / Ultra**, auto-detected from GPU and frame time, adjustable by the player. Tiers change: resolution scale, shadow map size (or blob shadows), hatching on/off, outline resolution, bloom resolution, particle count, prop/crowd density, number of dynamic lights, AO.

---

## 6. Useful external resources

| Resource | Use | License |
|---|---|---|
| **Kenney** (kenney.nl), **Quaternius** | Placeholder vehicles/props for the prototype | CC0 |
| **Poly Haven**, **ambientCG** | Grunge/rust masks and noise textures to paint over; not final albedo | CC0 |
| **Three.js examples** (WebGPU: toon, outline, bloom, LUT, tiled lights, compute particles) | Starting points for the shaders | MIT |
| Hatching/TAM papers (Praun et al., *Real-Time Hatching*, 2001) | Theory behind the hatching shader | — |
| Games using similar techniques, for **technique study only**: Borderlands series (texture-lines + outlines), Sable (line rendering), Hand of Fate / comic-ink shaders | Reference for outline and hatching solutions | — |
| AI image-to-3D tools (Meshy, Tripo, Rodin…) | Fast blockouts from concept art; always retopologize and repaint, and check the tool's license terms | varies |
| Free display fonts (Google Fonts) | HUD typography | OFL |

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Comic look requires lots of hand-painted art | Trim sheets, modular kits, shared atlas per biome; prove the look on **one track section + 2 vehicles** first. |
| Outline + hatching + bloom + fog too heavy on mobile | Quality tiers from day one; measure on a real mid-range phone early. |
| Many dynamic lights on mobile | Bake static lights; fake light pools with decals. |
| Visual noise hurts readability | Value-contrast rules: track surface mid-value, vehicles brighter/rim-lit, hazards with emissive accent; test with a grayscale view. |
| WebGPU/TSL APIs still evolving | Pin the Three.js version; upgrade deliberately. |
| IP closeness of some references | Original faction design pass before production art. |

---

## 8. Open decisions

| ID | Question | Recommendation |
|---|---|---|
| **D1** | Final style: ink-comic (engine refs) or painterly semi-realistic (vehicle/world refs)? | ✅ **Decided (2026-11-12): ink-comic.** `vehicles`/`world` refs are content and color inspiration only. |
| **D2** | Camera: fixed orientation top-down (engine refs 1–3, 5–6) or chase camera rotating with the track (closer to ref 4)? | ✅ **Decided (2026-11-12): high 3/4 camera rotating with the track.** **Update (2026-11-13):** a fixed-orientation near-isometric "board" camera (engine refs 1, 2, 5, 6) is now the default; the rotating chase camera stays available via the debug panel (`camera.mode`). |
| **D3** | Renderer: WebGPU + TSL (with WebGL2 fallback) or WebGL2 only? | ✅ **Decided (2026-11-12): `WebGPURenderer` + TSL with automatic WebGL2 fallback.** |
| **D4** | Minimum mobile target? | ✅ **Decided (2026-11-12): mid-range 2021** (e.g. iPhone 12, Galaxy A52 class). Must hold a stable 30 fps at Low/Medium tier. |
| **D5** | Racers per race and game mode? | ✅ **Revised (2026-11-12): configurable 4–8 racers, default 4** (player + 3 AI, as in [gameplay.md](gameplay.md)). Single player vs AI, plus **2-player split screen on PC only**. No online multiplayer for now; the simulation stays fixed-timestep so it can be added later. |
| **D6** | Biome for the first vertical slice? | ✅ **Decided (2026-11-12): steam foundry** (riveted plates, grates, furnaces, steam: engine refs 1, 4). |

---

## 9. Next steps

1. ~~Resolve open decisions D1–D6.~~ Done.
2. **[Doc 02 — Shader & style spec](02-shader-style-spec.md)**: exact shading model, outline/hatching parameters, palette and LUTs per biome. *(v0.2, S1–S4 decided.)*
3. **[Doc 03 — Engine architecture](03-engine-architecture.md)**: module structure, game loop, scene management, asset loading, quality tiers, milestones M0–M3. *(Draft written.)*
4. **Prototype 0 ("look test")**: one short track section, 2 placeholder vehicles, outlines + hatching + bloom + smoke, running on desktop and one phone.
