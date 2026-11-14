# Steam Racers

Steam-powered combat racing in the Southern Wastelands. Three.js (WebGPU + WebGL2 fallback), TypeScript, Vite, PWA. PC and mobile.

## Documents

| Doc | Content |
|---|---|
| [00 — World & Lore](docs/00-world-lore.md) | Setting and its design implications |
| [01 — Engine & Visual Direction](docs/01-engine-visual-direction.md) | Reference analysis, visual pillars, stack, decisions D1–D6 |
| [02 — Shader & Style Spec](docs/02-shader-style-spec.md) | Ink-comic rendering pipeline, parameters, palette |
| [03 — Engine Architecture](docs/03-engine-architecture.md) | Code structure, loop, systems, tooling, milestones |
| [04 — Grand Prix & worlds](docs/04-grand-prix.md) | M4 plan, Cup flow, the four faction worlds |
| [gameplay.md](docs/gameplay.md) | Gameplay reference (Italian) |
| [Testing checklist](docs/testing-checklist.md) | Manual tests per milestone, PC + phone |

## Commands

```bash
npm install
npm run dev          # dev server (also on LAN for phone testing)
npm run build        # typecheck + production build + PWA service worker
npm run preview      # serve the production build
npm run test         # unit tests (Vitest)
npm run test:e2e     # Playwright: desktop + emulated mobile (first time: npx playwright install chromium)
npm run test:all     # typecheck + unit + e2e
npx tsx tools/sim/run.ts --racers 4 --laps 3   # headless autopilot race, JSON stats (--track proving-ground)
npx tsx tools/sim/stress.ts                    # physics stability under abusive driving (--track proving-ground)
node tools/probe.mjs 10 "laps=1"              # print game snapshots from a headless page
node tools/shoot.mjs <outDir> 'name={"post.debugView":"grayscale"}'   # headless screenshots with tunables (dev server running)
```

## URL flags

The game opens on the title screen (Grand Prix, Single race). `?quick` (or `?test`) skips the menus and starts a race from the flags below.

`?debug` tuning panel · `?track=foundry-01|proving-ground` · `?tier=low|medium|high|ultra` · `?backend=webgl2` · `?players=2` (PC split screen) · `?touch=1|0` · `?seed=N` · `?racers=4..8` · `?laps=1..9`

## Status

**M0 — Setup** done: renderer bootstrap with backend detection, fixed-step loop, seeded RNG, event bus, tunables registry + `?debug` panel, input actions (keyboard P1/P2, gamepad, touch), split screen on PC, quality tiers + dynamic resolution, asset manager skeleton, PWA manifest, unit and e2e tests. **M1 — Look test** implemented: `InkLit` material (banded ramp, hatching, sheen, emissive presets), ink pipeline (outlines, bloom, grade, paper, grain, FXAA/SMAA, debug views), height fog, steam/smoke particles, procedural textures, foundry track section with two placeholder vehicles, seeded set-dressing generator (props in bands around the track, instanced), molten-metal pool. Calibration notes in doc 02 §18. **M2 — Driving prototype** implemented: block-based track format + compiler, Rapier vehicles with gear-based arcade handling (steam push, brake/reverse, surface grip, drift), laps/positions/countdown/results, autopilot rivals, headless race runner (`tools/sim/run.ts`). **M3 — Race vertical slice** implemented (AI, start test, boiler, hull, cannon, split screen). **M4 — Grand Prix** ([doc 04](docs/04-grand-prix.md)): phase A done — biome system, track format v2 with ramps, crests and jumps, coal and money crates, hazard zones (test track `?track=proving-ground`); phase B done — title and setup menus, the 4-race Cup with prizes, standings, workshop upgrades, difficulty and AI growth, saved between sessions. Next: phase C, the four worlds (the Cup runs on stand-in tracks until then).
