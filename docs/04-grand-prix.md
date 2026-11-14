# 04 — Grand Prix & the four worlds

> Status: **v0.4** (2026-11-14) — milestone plan and world bible. **Phases A, B and C implemented** (notes in §9, §10 and §11). Decisions G1–G5 and open points G6–G7 in §8.
> Depends on: [00 — World & Lore](00-world-lore.md), [01 — Visual direction](01-engine-visual-direction.md) §1.3, [02 — Shader spec](02-shader-style-spec.md) §12–13, [03 — Architecture](03-engine-architecture.md) §7, [gameplay.md](gameplay.md) §2.1, §9.
> Milestone name: **M4 — Grand Prix** (M3 is the race vertical slice, already implemented).

---

## 1. Goal

One playable **Steam Racers Cup**: four races in a row, one per faction world, with money, a workshop between races, standings, and AI that grows from race to race. Each world must be recognisable in one screenshot at the top-down camera, while staying inside the ink-comic style (doc 01 D1).

**Exit criteria:** a full 4-race Cup played from the title screen to the trophy, on PC (1 and 2 players) and on a phone, at target FPS on every track; the headless runner completes a full season on all four tracks without stuck cars.

---

## 2. What exists and what is missing

| Area | Today (after M3) | Needed for M4 |
|---|---|---|
| Flow | Game boots straight into a race on `foundry-01`; URL flags for players/racers/laps | Title screen, mode select, difficulty, vehicle select, season loop |
| World | `foundry-scene.ts`: one hard-coded biome (lights, fog, textures, landmarks) | Data-driven **biome definition**, four new biomes |
| Track format | Flat chain of `start/straight/curve`, 6 surfaces, 6 barricades | New surfaces and barricades, hazard zones, pickup slots, landmark slots |
| Dressing | Seeded bands, themes chosen by barricade type | Prop catalogues and themes per biome |
| Rules | Start test, boiler, hull, cannon, AI | Pickups (money bag, coal), signature hazards, difficulty levels, AI growth, workshop stats |
| Economy | — | Prize money, repair cost, Cup standings, workshop prices |
| Persistence | — | Season save (resume after closing the PWA) |

Out of scope (later): career Credits and Garage, modules, full arsenal, cards and race events, driving school, level editor, Steam Special unlock.

---

## 3. Milestone steps

Each step ends with tests (unit + headless sim where relevant) and a `testing-checklist.md` section.

### Phase A — Foundations ✅ implemented (§9)

| # | Step | Content |
|---|---|---|
| A1 | **Biome system** | `src/biomes/<id>.ts` exports a `BiomeDef`: palette tokens, ink colour, ramp rows, key/hemisphere light, fog (colour, density, height), LUT/grade, emissive presets, particle emitters (ambient: embers, dust, rain, spores), procedural texture recipes per surface and barricade, prop catalogue + dressing themes, sky/backdrop. `foundry-scene.ts` becomes a generic `world-builder.ts`; the foundry is ported first as a regression (screenshots before/after must match). |
| A2 | **Track format v2** | `biome` drives the world. New surfaces and barricades (§5), optional per-piece `zone` tag (dressing district), `hazard` (§6), `pickups` slots, `landmark` slots (reserved footprint for hand-built set pieces, kept clear by the dressing). Compiler validation + unit tests. |
| A3 | **Pickups** | Crates on the road: coal (PV), money bag ($5,000, Cup only). Respawn timer, seeded placement in slots, AI line bias towards them, HUD money counter. Ammo and card crates stay for later. |
| A4 | **Hazard zones** | One generic, deterministic system: a zone on the track with a timed cycle (idle → warning → active), an effect (damage, crash, grip, steam gain/loss, push) and a visual skin per world. AI reads the cycle (skill-dependent timing). |
| A5 | **Elevation, ramps and jumps** (G4) | Track format: per-piece height change in 4 m levels (doc 03 §7.3): `ramp` (straight that climbs/descends one level), `crest` and `jump` (lip + gap + landing, gap length per size), optional bank on curves later. Compiler: 3D centre line (height + pitch per sample), validation of slopes, gaps and closure in height. Physics: road built as a trimesh/heightfield per piece instead of the flat ground slab; the invisible rail (doc 03 §7.4) works on the 3D samples; walls only where the road is on the ground (jump gaps open). Rules: clean landing gives PV (gameplay.md §5.1), hard landing costs a gear, airborne = no steering and no push, out-of-track fall = reposition. AI: target gear for each jump, no push before a lip. Camera: smooth pitch on slopes, no clipping on crests. Headless stress test with jumps at all masses (no tumble rule of doc 03 §7.4 stays). Overpasses (the road crossing over itself) are **not** in M4. |

### Phase B — Cup flow ✅ implemented (§10)

| # | Step | Content |
|---|---|---|
| B1 | **Front-end** | Preact screens, navigable with keyboard, gamepad and touch: title → mode (Grand Prix / Single race) → players (1/2 on PC) → difficulty → vehicle → (single race: track). Pause menu with *Retire* and *Restart* (single race only). |
| B2 | **Season loop** | Cup state machine: briefing card of the world → race → results → Cup standings → workshop → next race. Grid in standings order, leader on pole (G5). Prize money 100k/60k/30k/10k for 4 racers (scaled when racers > 4), money bags, repair cost when wrecked. Winner = most money earned (gameplay.md §2.1). Season saved in `localStorage` after each race. |
| B3 | **Workshop (Officina)** | Four lines: Acceleration, Top speed, Tyres, Suspension; 4 levels each, growing prices; effects mapped onto `stats.*` / `handling.*`. Valid for the season only. |
| B4 | **Difficulty and AI growth** | Easy / Normal / Hard: AI skill, speed factor, growth per race (AI buy upgrades with their own money using the same prices), prize scale. Light catch-up for the back of the pack only (no rubber-band boost for the leader). |

### Phase C — The four worlds (one track each, in Cup order) ✅ implemented (§11)

Each world step contains: track layout (block chain), biome definition, surface/barricade textures, prop catalogue, one hand-built **landmark**, crowd/stands, signature hazard skin, ambient particles, LUT tuned against the world ref, phone performance check.

| # | World | Track | Character |
|---|---|---|---|
| C1 | Dwarven deep-hall | *Runegate Deep* | technical, medium speed, the "learning" race |
| C2 | Victorian industrial city | *Cinderholme Grand Station* | street circuit, 90° corners, a level crossing |
| C3 | Orc scrapyard | *Rustmaw Pit* | wide, rough, fast with rough surfaces, many hard edges |
| C4 | Elven village | *Lirael Canopy* | fast and flowing, long curves, rain: the finale |

### Phase D — Close

| # | Step | Content |
|---|---|---|
| D1 | **Balancing** | Headless runner: `--track` on all four, new `--season` mode (4 races, workshop AI, standings), lap time targets (§4), no stuck/repositions, hazard hit rates. |
| D2 | **Performance** | Per-world budget for lights, particles and instanced props; phone test on each track; quality tiers (rain and crowds drop first). |
| D3 | **Docs** ✅ | Update doc 03 (milestones, biome system, track format v2), doc 02 (palettes §12 per world), README, testing checklist. Done 2026-11-14: doc 03 §3, §7.6, §14, §18; doc 02 §12.1. |

Suggested order: A1 → A2 → A5 (elevation changes physics and the format, so it lands before new tracks are authored) → C1 (first new world proves the biome system) → A3/A4 → B1–B4 → C2–C4 → D. One world can be built while the Cup flow is in progress.

---

## 4. Shared track rules

- Real height changes (A5): ramps between 4 m levels and jumps; on top of that, depth from the surroundings (walls rising, chasms falling away, arches **over** the track as non-colliding set pieces). Each track uses elevation in its own way (§7: descent, bridge, jumps, canopy levels).
- Lap length **1.0–1.4 km**, lap time target **55–75 s** with a mid upgrade level; 3 laps.
- 14 m wide (A6): 4 cars side by side everywhere; chicanes use 10 m hairpins sparingly (max 2 per track).
- Every track has: one long straight for the cannon and slipstream, one hairpin, one surface change, at least three barricade types, one signature hazard, one landmark visible from the start grid.
- Readability (doc 02 §13): road is always mid-value and lower saturation than the vehicles; world accents (runes, neon, gas light) never use the racer identity colours; hazard warning = orange (shared across worlds), pickups = a reserved brass-white glow with a ring on the ground.

---

## 5. Material vocabulary

New surfaces and barricades, all with tunable grip/drag (`surfaces.*`) and edge reaction (`barricades.*`). Existing ones stay valid everywhere.

| New surface | World | Grip | Notes |
|---|---|---|---|
| `flagstone` | Dwarven | high | Big carved slabs, rune-inlaid seams |
| `rails` | Dwarven, Victorian | medium, slight lateral slip | Mine/tram rails sunk in the road |
| `cobble` | Victorian | medium (low when wet) | Wet sheen on high tier |
| `scrap` | Orc | medium-low, rough (shake) | Welded plates and bolted panels |
| `mud` | Orc, Elven | low, high drag | |
| `heartwood` | Elven | high | Living wood planks with silver inlays |
| `moss` | Elven | low | Edges of the canopy road |

| New barricade | World | Reaction (gameplay.md §6.3 style) |
|---|---|---|
| `stone` | Dwarven | hard: PF already at medium hits (like riveted) |
| `runepylon` | Dwarven | no PF, but the arc discharge drains 1 PV on contact |
| `ironrail` | Victorian | cast-iron railing: PF at violent hits, smooth scrape |
| `wreckwall` | Orc | piled car wrecks: like hedgehog (+1 PF) |
| `tyres` | Orc | soft: absorbs crashes, slows the scrape |
| `roots` | Elven | living roots: soft, slows like sandbags |
| `crystal` | Elven | hard and slippery: low scrape slowdown, PF at violent hits |

---

## 6. Signature hazards (one generic system, four skins)

| World | Hazard | Cycle | Effect | Read for the player |
|---|---|---|---|---|
| Dwarven | **Forge vents**: grates across the road over a magma channel | ~8 s idle, 1.5 s warning, 1.5 s jet | 1 PF and +1 PV (heat) when crossing an active jet | grate glows orange, then a fire column |
| Victorian | **Level crossing**: a freight train crosses the road | ~25 s, 3 s warning (bell, red lamps, barriers drop), train 4 s | train = crash and 3 PF; barriers are soft (slow down) | gantry lamps, bell, barrier arms, smoke from the left before it appears |
| Orc | **Magnet crane**: drops a scrap block on a marked spot, lifts it again | ~12 s, 2 s warning (shadow circle grows), block stays 6 s | impact 4 PF; while on the road the block is a wall to steer around | crane arm swings, shadow circle on the ground |
| Elven | **Sap streams**: glowing rune lanes along the racing line | always on, pulse every 6 s | driving on a lit lane gives PV (passive generation ×3); off-pulse lanes are slippery | flowing cyan lines on the road, pulse wave |

Three are threats, the elven one is a reward with a risk (grip): the finale rewards line choice instead of punishing it.

---

## 7. World bible

Shared lore frame: one hundred years after the sealing of the rift, each faction hosts one leg of the underground Cup organised by the Steam Council of Iron City. Magic is unstable: every world shows **rune-tech** (doc 01 §1.3), but each in its own way: the dwarves **forge** it, the humans **ignore** it and burn coal, the orcs **steal** it, the elves **grow** it.

### 7.1 Dwarven deep-hall — *Runegate Deep*

**Concept.** A race through the abandoned deep halls of a dwarven hold, now a mining and forge complex. The road runs between colossal carved pillars wrapped in cables and brass pipes, under vaults lost in darkness. At the centre stands the **Rune Engine**: a throne-sized machine of gold and black stone, framed by giant gears, that keeps the hold's runes alive since magic became unstable. Holographic rune maps of the mines hang in the air like slow-moving blueprints.

**Lore hook.** The dwarves sealed the rift with runes; here the runes are still maintained, measured and rationed. The leg is called "the Descent": the track spirals down into the hold.

**Distinctive elements.**
- Square, monumental geometry: everything is carved, faceted, symmetric (vs the curves of the elves and the chaos of the orcs).
- Runes are **orange (forge) and cyan (seal)** and carved in stone, never floating text.
- Mine rails and ore carts cross the halls; conveyor belts carry glowing ore above the road.
- Holographic rune-maps: big translucent cyan planes with wireframe terrain (cheap: additive textured quads with scanlines).
- Statues of ancestor kings with stone beards guard the straight.

**Landmark.** The Rune Engine on its stepped dais, visible from the grid, with a pulsing red-magenta core and gears turning behind it.

**Palette.**

| Token | Hex | Use |
|---|---|---|
| `ink` | `#0F1216` | cold, almost blue-black |
| `basalt` | `#2E333B` | pillars, walls |
| `stone` | `#565A60` | flagstones |
| `brass` / `gold` | `#9C7A3C` / `#D2A64A` | pipes, gears, trims |
| `forge` | `#FF7A2A` | emissive runes, magma |
| `seal` | `#3FC8FF` | seal runes, holograms |
| `core` | `#FF3F6E` | Rune Engine core only |
| `fog` | `#141A22` | darkness above |

**Light and atmosphere.** No sky: the scene fades to black fog above and at the edges. Key light is a **cold shaft from above** (`#8FA6C8`, low intensity), the warm light comes from forge channels and braziers. Floating dust in the light shafts, sparks from the forge, steam from cooling pools.

**Track.** Flagstone with a rails section and a grate bridge over a magma channel (forge vents). Elevation: the **Descent**, two ramps down one level each from the grid towards the Rune Engine, and one long ramp back up to the start; no jumps (the learning race). Barricades: `stone` and `runepylon`, riveted near the forges. Medium speed, many 30 m curves, one hairpin around the Rune Engine dais.

**Dressing.** Edge: ore carts, crates with rune seals, anvils, braziers, cable bundles. Mid: pillars (as a regular colonnade, not random), forges, boilers with rune plates, conveyor gantries. Far: vault walls, giant gears, the dark.

**Crowd.** Armoured dwarves on stone galleries between the pillars, lanterns.

### 7.2 Victorian industrial city — *Cinderholme Grand Station*

**Concept.** The human capital of the Kingdom, the most industrialised place in the world: brick and cast iron, a forest of smokestacks, gas lamps, wet cobblestones, tram rails, airships moored above. The race is a **street circuit**: market square, railway yards, a canal bridge and the domed **Grand Station** with its clock-face rose window.

**Lore hook.** Humans were the first to abandon magic for coal and steam: no runes at all in public (the only glow is gas light and furnace). The Cup leg is a public holiday: bunting, banners, brass bands, betting booths.

**Distinctive elements.**
- **The only world without runes**: all light is warm (gas lamps, windows, furnaces). Its contrast with the other three is its identity.
- Orderly urban grid: right-angle corners, kerbs, street furniture (lamp posts, pillar boxes, benches, market stalls).
- Wet cobble reflections and puddles; drizzle (high tier).
- Airships drifting overhead, casting moving shadows on the track.
- Smokestacks everywhere: the heaviest smoke of the four worlds (grey-brown, slow).
- Heraldry: an original crest (crowned cogwheel between two hammers) on banners and on the station.

**Landmark.** The Grand Station dome with the clock rose window, lit amber, the finish straight in front of it.

**Palette.**

| Token | Hex | Use |
|---|---|---|
| `ink` | `#1A1310` | warm brown-black |
| `soot` | `#3A322C` | buildings in shadow |
| `brick` | `#7A3E2E` | walls |
| `slate` | `#4A5058` | roofs, dome |
| `verdigris` | `#5E8A7A` | copper roofs, statues |
| `cobble` | `#5A524A` | road |
| `gaslight` | `#FFC46A` | lamps, windows |
| `furnace` | `#FF8A2A` | foundries, train firebox |
| `fog` | `#4A443E` | grey-brown smog |

**Light and atmosphere.** Overcast dusk: dim grey key light (`#B8A898`), every lamp a pool of amber light (light-pool decals, few real point lights). Smog fog thicker in the distance. Steam leaking from manholes.

**Track.** Cobble with a tram-rails street and a paved canal bridge. Barricades: `ironrail` in the streets, crates and sandbags at the chicanes, `corrugated` in the railway yards. Corners mostly size-1/size-2 at 90°: technical, braking matters. Level crossing on the yard straight. Elevation: a humped **canal bridge** (crest: up and down one level, cars go light on top) and a ramp down into the railway cutting.

**Dressing.** Edge: lamp posts (regular spacing along kerbs), market stalls, crates, barrels, cart wheels, coal heaps. Mid: brick terrace houses (simple boxes with windows), warehouses, gasometers. Far: smokestacks, station dome, airships.

**Crowd.** Dense: balconies, windows, stands in the square; bunting strung across the road.

### 7.3 Orc scrapyard — *Rustmaw Pit*

**Concept.** A scrap city on the rim of the meteor crater, in the desert: towers of corrugated metal and welded wrecks, cranes and magnets, giant **horns and tusks** jutting from the buildings, crude neon signs. The race runs through the yard, between scrap mountains and the colossal **idol of the Warlord**, welded from war-machine wrecks.

**Lore hook.** The orcs fought for the meteorite and lost the Great Battle; now they live off the scrap of that war, and off **stolen rune-crystals** wired into neon signs that flicker and short-circuit. The horns and bones are the remains of the extraplanar creatures that came out of the rift, used as building material.

**Original iconography (IP note, doc 01 §1.5).** No borrowed slogans or glyphs. Clan sigil: a **broken cogwheel bitten by a tusked jaw**; signs use a blocky, hammered-in script of our own; colour code red + toxic green. Statues are of a specific invented warlord (one tusk broken, a boiler on the back).

**Distinctive elements.**
- Chaos and asymmetry: nothing is straight, everything is patched, bolted, leaning.
- Bone + metal: horns and tusks of rift creatures on buildings and barricades.
- Crude neon in red and green, flickering (unstable stolen runes).
- Desert light: the only open sky with a low, hot sun through dust.
- Cranes with magnets, moving all the time (and the hazard).

**Landmark.** The Warlord idol on a scrap tower, with a furnace in its chest, at the end of the long straight.

**Palette.**

| Token | Hex | Use |
|---|---|---|
| `ink` | `#1C1208` | |
| `rust` | `#7A4422` | buildings |
| `scrap` | `#5E564A` | plates |
| `sand` | `#B08A5A` | road, desert |
| `bone` | `#D8C8A8` | horns, tusks |
| `toxic` | `#6CFF3A` | neon, signs |
| `blood` | `#FF2A2A` | neon, signs |
| `sun` | `#FFC07A` | key light |
| `fog` | `#8A6A48` | dust haze |

**Light and atmosphere.** Strong warm backlight from a low sun (`#FFC07A`), long shadows, thick ochre dust haze in the distance, black smoke columns from furnaces, dust devils.

**Track.** Sand and scrap with a mud pit and oil slicks. Barricades: `wreckwall`, `tyres`, `hedgehog`, `corrugated`, `barbed`. Wide and fast with rough surfaces: the race for heavy vehicles and ramming. Crane on a fast curve exit. Elevation: the **jump track**, two jumps over scrap ditches (one short on the main straight, one long off a wreck ramp) and a drop into the mud pit.

**Dressing.** Edge: tyre stacks, oil drums, wrecks, spikes, bones, scrap piles. Mid: shacks, scrap towers, cranes, furnaces, horns. Far: scrap mountains, the crater rim, desert mesas.

**Crowd.** Orcs on top of scrap towers and wrecks, waving; fireworks/flares at the finish.

### 7.4 Elven village — *Lirael Canopy*

**Concept.** A city grown, not built: giant trees whose canopies glow cyan and blue, organic towers of living wood and silver, walkways and bridges between the trunks, flowing rune banners, statues of archers and mages. Constant rain; snowy mountains in the mist. The road runs **on the canopy level**: flat, but with chasms of mist below the edges.

**Lore hook.** The elves never gave up magic: they found a way to make it flow through living wood, and their steam comes from sap boilers inside the trunks ("tree-lungs" breathing white steam). Here the rune energy is stable: the only place where it is beautiful instead of dangerous.

**Distinctive elements.**
- Total fusion: trunks with brass valves grown into the bark, crystal pipes running inside the roots, steam from vents in the branches.
- Flowing, vertical, curved shapes: no right angles at all.
- Runes in **cyan and green**, flowing like water on vertical banners; small warm amber windows in the trunks.
- Rain and wet reflective walkways; mist chasms on both sides of the road.
- Bioluminescent leaves and spores drifting in the air.

**Landmark.** The Mother Tree with the giant mage statue in its trunk, the road circling it in a long curve.

**Palette.**

| Token | Hex | Use |
|---|---|---|
| `ink` | `#0E1614` | green-black |
| `bark` | `#3A3A36` | trunks |
| `silverwood` | `#8A9290` | towers, rails |
| `moss` | `#3E5A3E` | ground, moss |
| `leaf` | `#1F7A6A` | canopy |
| `rune-cyan` | `#3FF0E0` | runes, sap |
| `rune-green` | `#5AFF8A` | runes |
| `window` | `#FFB86A` | small warm accents |
| `fog` | `#4A5A60` | cold rain mist |

**Light and atmosphere.** Cold, diffuse, rainy light (`#A8BCC4`), the strongest bloom of the four worlds (canopies, runes), rain streaks and ripples on puddles (high tier), mist below the road.

**Track.** Heartwood with moss edges, a stone path section and a shallow stream ford. Barricades: `roots`, `crystal`, `earth`. Long size-3 curves and fast straights: the fastest track, with sap streams on the racing line. Elevation: **canopy levels**, long climbing curve around the Mother Tree, one jump across a mist gap between two trunks.

**Dressing.** Edge: roots, glowing mushrooms, crystal lamps, rune stones. Mid: trunks with doors and windows, banners, statues, steam vents. Far: giant trees, towers, mountains in the mist (backdrop cards).

**Crowd.** Elves on curved walkways and branches, sparse and elegant (the smallest crowd: calm vs the orc chaos).

### 7.5 Side-by-side identity

| | Dwarven | Victorian | Orc | Elven |
|---|---|---|---|---|
| Shapes | square, carved, symmetric | orderly urban grid | chaotic, asymmetric, patched | flowing, organic, vertical |
| Main material | stone + brass | brick + cast iron | scrap + bone | living wood + silver |
| Light | darkness + forge | warm gas light, smog | low desert sun | cold rain + bioluminescence |
| Runes | carved, orange/cyan | **none** | stolen, flickering neon | living, flowing cyan/green |
| Sky | none (indoor) | smoky dusk | dusty sun | rain and mist |
| Weather/particles | dust in shafts, sparks | drizzle, heavy smoke | dust, black smoke | rain, spores |
| Hazard | forge vents | level crossing | magnet crane | sap streams |
| Driving | technical | braking, 90° corners | wide, rough, ramming | fast, flowing |
| Elevation | descent ramps | canal bridge crest | jumps over ditches | canopy climb + mist gap |

---

## 8. Decisions and open points

| ID | Question | Status |
|---|---|---|
| G1 | Cup structure | ✅ **Decided (2026-11-13):** one Cup of 4 races, one per world, in the order Dwarven → Victorian → Orc → Elven |
| G2 | Fate of `foundry-01` (Iron City) | ✅ **Decided (2026-11-13):** extra Single race track and regression scene, not in the Cup |
| G3 | Gameplay scope of the worlds | ✅ **Decided (2026-11-13):** one signature hazard per world (§6) + coal and money-bag crates |
| G4 | Elevation | ✅ **Decided (2026-11-13):** real ramps and jumps (step A5); overpasses later |
| G5 | Grid order in the Cup | ✅ **Decided (2026-11-13):** standings order, leader on pole (gameplay.md §4) |
| G6 | Art pipeline | Proposal: primitives + procedural painted textures as in M1; GLB kits from Blender later |
| G7 | Workshop levels and prices, prize scaling for 5–8 racers | First values in code (§10): prices 20k/35k/55k/80k per level, 8-racer prize table, repair $20k; to tune with the season runner (D1) |

---

## 9. Phase A implementation notes (2026-11-13)

| Step | Where | What is in |
|---|---|---|
| A1 Biome system | `src/world/biome.ts` (`BiomeDef`, `WorldContext`), `src/world/build.ts` (`buildWorld`), `src/world/kit.ts` (shared helpers), `src/biomes/foundry.ts`, `src/biomes/index.ts` | A biome is data (tunables preset for light/fog/ink/post, ground and road looks per surface, dressing themes per barricade, gantry banner, pit floor) plus two hooks: `decorate(ctx)` for hand-placed set pieces and `landmark(ctx, slot)`. The builder does the generic parts: lights, fog, terrain, road ribbons, skirts, pits, start gantry, barricades, landmark placeholders, dressing. The foundry is the first biome: same set pieces and same dressing (3356 instances on `foundry-01`, before and after). `src/game/foundry-scene.ts` is gone. |
| A2 Track format v2 | `src/track/track-format.ts`, `src/track/compile.ts`, `src/tracks/index.ts`, `?track=<id>` | New surfaces and barricades of §5 (grip/drag, edge reaction, PF, sparks/dust, placeholder visuals; rune pylons drain 1 PV on a hit and every 1.5 s of scraping). Per piece: `rise`, `crest`, `zone`, `pickups`, `hazard`, `landmark`; per track: `level` (4 m). v1 files compile unchanged. Test track: `src/tracks/proving-ground.json` (foundry biome, every feature once). |
| A5 Elevation | compiler (y, grade, feature per sample; height closure; max grade 26 %; jump ballistics), `RaceSim.buildStatic` (road trimesh instead of the ground slab, walls follow the heights, none over gaps), `RaceSim.reposition` (after the landing), `world/build.ts` (height field terrain, skirts, pits) | `jump` = kicker (10 m, lip 1.5 m) + gap + landing ramp (14 m); `minSpeed` from the ballistics with a 20 % margin. Falling more than 4 m below the road line → reposition after the jump. Landing (`sim/track-features.ts`): clean = +1 PV, hard (vertical speed > 10 m/s or tilted) = −1 gear. AI: carries 1–1.45 × the needed speed over the lip, never brakes on the approach. Camera follows the road height. Stress test: `npx tsx tools/sim/stress.ts --track proving-ground` (no tumble, no spin). |
| A3 Pickups | `sim/track-features.ts`, `game/feature-views.ts`, HUD money box | Coal crate +2 PV, money bag +$5,000 (`rules.money`, shown in the HUD strip), respawn 8 s, tunables group `pickups`. AI detours up to 4 m for a crate (coal only when the boiler has room). |
| A4 Hazards | `src/track/hazards.ts` (presets, clock), `sim/track-features.ts` (effects), `game/feature-views.ts` (placeholder skins) | Effects per phase: damage, crash, steam, steamRate, grip, slow, solid (a wall collider switched on). One-shot effects once per cycle. Presets for vent, crossing, crane, stream (§6). AI predicts the phase on arrival: steers around partial-width threats, waits for full-width ones, follows streams; a careless driver (skill check per cycle) goes for it. Tunables group `hazards` (on/off, crash stop, zone margin). |

Also changed on the way:

- **AI avoidance** now looks at every slower car or wreck ahead **on the lap position** (a lapped wreck is still in the way) and picks the clearest lateral line. Before, two wrecks side by side (e.g. after a train) blocked the cars behind for good.
- Sim numbers on `foundry-01` moved slightly (trimesh road, new avoidance); no repositions, no stuck cars.

Known limits (for phase C): hazard and pickup skins are placeholders; road skirts use one generic material; the terrain near folded parts of an elevated track can show steep faces (cliffs); the stream skin is a straight strip (follows the tangent at its centre, not the curve).

---

## 10. Phase B implementation notes (2026-11-14)

| Step | Where | What is in |
|---|---|---|
| B1 Front-end | `src/flow/flow.ts` (Flow controller), `src/ui/Menus.tsx` (screens), `src/ui/menu-nav.ts` (keyboard / gamepad / touch navigation), `src/ui/App.tsx` | Title (Continue Cup when a save exists, Grand Prix, Single race) → players (PC only) → difficulty → vehicle (per player) → track (single race only). Pause menu: Resume, Restart (not in the Cup), Retire, Title. Menus: arrows/WASD + Enter/Space + Esc/Backspace, d-pad/stick + A/B, tap. `?test` and the new `?quick` boot straight into the M3 race from the URL flags (tests and dev); `?test&menu=1` keeps the menus. |
| B2 Season loop | `src/cup/cup.ts` (pure, unit-tested), Flow | Briefing card (world, track, hazard, grid) → race → results with prize, money bags and repair → Cup standings (finishes per race, earned, cash, workshop levels) → workshop → next briefing; after race 4 → trophy. Grid: race 1 a seeded draw, then standings order with the leader on pole (G5). Prizes 100k/60k/30k/10k (4 racers) or 100k…5k (5–8), × difficulty; money bags $5,000; a wreck pays $20k repair (never below zero), a retirement from the pause menu pays none. Standings = total earned; workshop spending does not count against you. Saved in `localStorage` (`steamRacers.cup.v1`) after every race and purchase; a Cup quit mid-race resumes at that briefing; a finished Cup can still show its trophy, then the save is cleared. |
| B3 Workshop | `cup.ts` (`UPGRADE_*`, `tuneFor`), `PhysicsVehicle.tune` | Four lines × 4 levels, prices 20k/35k/55k/80k. Acceleration +6 %/level (engine accel), Top speed +2.5 %/level (every gear), Tyres +5 %/level grip, Suspension recovers 12 %/level of the grip loss and drag of rough surfaces. Season only. 2-player Cup: one workshop turn per player. |
| B4 Difficulty and AI growth | `DIFFICULTY` in `cup.ts`, `ai/driver.ts` | Easy / Normal / Hard: AI skill 0.4 / 0.7 / 0.92, AI pace 0.93 / 0.98 / 1.01 (top speed and accel), +0.6 / 1 / 1.4 % pace per race, prizes × 0.75 / 1 / 1.25. AI shop after every race with the same prices (preferred line order per racer, lowest level first; Hard keeps one repair in reserve). Catch-up: only an AI in the back half, more than `ai.catchUpGap` (60 m) behind the car ahead, gets × 1.03 / 1.03 / 1.02 top speed; never the leader. Single race uses the same AI levels with no upgrades and a random grid. |

Also changed on the way:

- **One Game per race.** `Game` is built from a `RaceSetup` (track, entrants with vehicle, colour, tune, skill; grid; seed) and `dispose()` frees physics, scene GPU resources, render pipelines, tunables listeners and HUD overlays; the procedural texture set is built once and shared. Checked in the browser: tunables listeners go back to the baseline and the world overlays are removed between races.
- Per-racer grid slot (`RacerConfig.grid`: the pole gets the wider start band) and per-vehicle `tune` / `maxSpeed()` in the sim; the AI read their own top speed.
- Debug panel and the `window.__steamRacers` test hooks follow the current race (`game` is a getter, `snapshot()` is null on the menus).

Real-phone check (2026-11-14, Realme RMX3370, `tools/phone/cup.ts`): the whole Cup flow works by touch, 43–54 fps in races 1 and 2, JS heap flat at 72 MB across races, save and resume OK. Fixed on the way: sticky main button on short screens (267 px tall with the browser bar), ≥ 44 px touch buttons, compact results table. Each Cup race shows the loading card for ~11–13 s on that phone (shader warm-up per race): to improve in D2. Details in `testing-checklist.md` (M4 phase B, Phone).

Known limits: no menu music or sounds; the AI shopping strategy and all prices are first guesses for D1; the results freeze the running order of rivals still racing when the player continues.

---

## 11. Phase C implementation notes (2026-11-14)

The four Cup worlds, each one track (`src/tracks/<id>.json`) and one biome (`src/biomes/<id>.ts`), built from primitives and procedural textures (G6). The Cup now runs on them; the stand-in mechanism of phase B is gone.

| Step | Track | Lap | Biome: what makes it recognisable |
|---|---|---|---|
| C1 | *Runegate Deep* (`runegate-deep`, `dwarven`) | 1048 m, flagstone + mine rails + forge grate; stone / rune pylons / riveted | Indoor dark hold with a cold key light from above and warm braziers. Regular colonnade of basalt pillars with carved forge/seal runes, ancestor-king statues on the Descent and the Ascent, conveyor gantries with glowing ore over the mine sections, magma channel under the forge grate (vent hazard), holographic rune maps, cold light shafts with dust, dwarf galleries at the start. **Rune Engine** on a three-step dais inside the hairpin: gold frame, pulsing core, turning gears. The Descent: two ramps down from the grid, one long ramp back up. |
| C2 | *Cinderholme Grand Station* (`cinderholme-station`, `victorian`) | 1108 m, wet cobble + tram rails + paved canal bridge; iron railings / sandbags / corrugated | Overcast dusk, smog and drizzle, no runes (warm gas light only). Brick terraces with lit windows and smoking chimneys, gas lamps at a regular spacing with light pools, bunting across the road, crowd stands with the crest banner (crowned cogwheel between two hammers), canal under the humped bridge with a barge, freight wagons and signals along the railway cutting (level crossing), skyline of smokestacks, airships circling. **Grand Station**: brick hall, verdigris dome, amber clock rose window, facing the finish straight. |
| C3 | *Rustmaw Pit* (`rustmaw-pit`, `orc`) | 1168 m, sand + scrap plates + an oil slick + the mud pit; tyres / wreck walls / hedgehogs / corrugated / barbed | Low hot sun through dust, the only open sky. Tusk arch over the start, leaning scrap towers with horns and red/toxic-green neon (clan sigil: a broken cogwheel bitten by a tusked jaw), magnet cranes swinging over the yard, furnaces with black smoke, dust devils, orcs on scrap stacks, crater rim. Two jumps (one on the main straight, a long one off the wreck ramp) and a drop into the mud pit. **Warlord idol**: a welded giant with a furnace in the chest, one tusk broken, a boiler on the back. |
| C4 | *Lirael Canopy* (`lirael-canopy`, `elven`) | 1245 m, heartwood + moss + stone path + a stream ford; roots / crystal / earth | Cold rain and mist, strongest bloom. Giant trees with glowing canopies and tree-lungs breathing steam, silverwood towers, rune banners flowing cyan and green, archer and mage statues, glowing mushrooms, crystal lamps with light pools, walkways between trunks, spores, snowy mountains far away. Sap streams on the avenue and around the Mother Tree; canopy climb and one jump over a mist gap. **Mother Tree** inside the long climbing curve, with the mage carved in its trunk. |

Shared pieces added on the way (`npm run check:tracks` prints the rules report of every track):

- **Track rules as code** (`src/track/rules.ts`, `tools/track/check.ts`): lap length, longest straight, hairpins, surfaces, barricade types, hazard, landmark, elevation and crates (§4). Unit test `tests/unit/cup-tracks.test.ts`: the four tracks follow the rules and two AI finish a lap on each with no repositions.
- **Biome definition** grows `props` (own dressing kit mixed by the themes, `Theme.own`), `theme` (fallback for barricades a biome does not list, so the foundry kit never leaks into other worlds), `debris`, `skirt`, `rain`, `clearView`, and an `animate` hook in the world context (gears, airships, banners, cranes). Helpers for hand-placed set pieces in `src/biomes/common.ts` (instanced batching, placement along the track and by zone, crowds, glow pools, painted textures).
- **The camera never loses the road** (`kit.viewHeightLimit`): the board camera has a fixed azimuth, so a tall prop between the camera and the road hides it. Hand-placed set pieces and tall dressing props (`PropDef.height`, biomes with `clearView`) are cut to the sight line on the camera side of the road and keep their full height behind it (stumps of pillars, low terraces, young trees). The crane hazard tower stands on the far side of the road.
- **World tunables reset per race**: the palette, light, fog, grade and wind keys go back to their defaults before a biome applies its own, so a race never inherits the previous world's look.
- New particles `ember` and `spore` (HDR, they bloom); GPU rain streaks around the camera (`RainField`, medium tier and up); brick and bark textures.
- The sap stream skin follows the curve of the road (it was a straight strip, §9 known limits).

Headless check (`tools/sim/run.ts`, 4 AI, 2 laps, seeds 1–2): no stuck cars, no repositions; laps 57–63 s (Runegate), 51–57 s (Cinderholme), 51–60 s (Rustmaw), 54–58 s (Lirael) with no upgrades. In the browser (desktop, high tier) the worlds build 3.6k–5k dressing instances in 14–43 instanced meshes, with warm-up of 2–4.5 s; the foundry is unchanged (3356 instances).

Known limits: the phone performance check of the four worlds is still to do (the device was offline); hazard skins other than the stream are the phase A ones (vent, crossing, crane fit their worlds but are simple); no crowd animation; lap times sit at the low end of the §4 target with no upgrades, to balance in D1 together with the season runner.
