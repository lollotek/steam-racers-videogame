# Manual Test Checklist

> Run per milestone on **PC** (keyboard + gamepad) and on a **real phone** (touch).
> Automated coverage: `npm run test` (unit) and `npm run test:e2e` (Playwright, desktop + emulated mobile).
> Headless Chromium has no WebGPU, so the automated runs exercise the WebGL2 fallback; WebGPU is verified here by hand.

## Setup

- Dev server reachable from the phone: `npm run dev` prints a LAN URL (`--host` is on). Phone and PC on the same network.
- WebGPU needs a secure context: `localhost` is fine on PC; from the phone use the HTTPS preview build or a tunnel.
- **Automated real-phone run (Android):** `npm run test:phone -- --adb D:\programmi\scrcpy-win64-v3.3.4\adb.exe --serial IP:PORT` drives Chrome on the phone over ADB (Playwright): WebGPU backend, boot/warm-up time, FPS during an autopilot lap at Medium, STEAM touch button, console errors, screenshots in `tools/phone/out/`. One-time setup: Developer options → Wireless debugging → Pair device with pairing code, then `adb pair IP:PAIR_PORT CODE`; the connect port is shown on the same screen. `adb reverse` serves the PC dev server as the phone's `localhost` (secure context: WebGPU without HTTPS). Feel, readability and real touch handling still need a human. `npm run test:phone:cup` does the same for the menus and the Cup flow (M4 phase B).
- **Phone performance probe:** `npx tsx tools/phone/perf.ts --adb … --serial IP[:PORT]` measures FPS and CPU time per frame part with each effect switched off in turn (`--only a,b`, `--fullscreen` taps into fullscreen first, `--profile 5` records a CPU profile and prints the hottest functions). Results and findings: doc 03 §16.1. Let the phone cool down between runs (results drift when it is hot).
- Phones enter fullscreen and lock landscape on the first tap (browsers allow it only after a gesture; the portrait hint says "tap to play fullscreen"); `?fullscreen=0` disables it. An installed PWA starts fullscreen.
- Add `?debug` to open the tuning panel. Useful flags: `?tier=low`, `?backend=webgl2`, `?players=2`, `?touch=1`, `?seed=123`.

## M0 — Setup

### PC (Chrome/Edge, WebGPU)

- [ ] Page loads, badge at the bottom shows `webgpu`.
- [ ] `?backend=webgl2` shows `webgl2` and the scene still renders.
- [ ] Vehicle moves on its own in 1st gear (no throttle).
- [ ] ↑ = steam push + gear up (cooldown ~1 s), ↓ tap = gear down, ↓ hold = brake → reverse, ← → steer.
- [ ] WASD also works in single player.
- [ ] Esc / P pauses and resumes; switching tab pauses automatically.
- [ ] Gamepad: A = steam push, LT = gear down/brake, left stick = steer, Start = pause. HUD shows `gamepad`.
- [ ] `?players=2`: two horizontal views; arrows drive the top player, WASD the bottom one; a second gamepad drives P2.
- [ ] `?debug`: panel lists Monitor, Presets and the groups input / camera / vehicle / quality / sim. Changing `camera.distance` or `vehicle.maxSpeed` acts immediately. Save → reload page → Load restores values. Export copies JSON.

### Phone (landscape)

- [ ] Portrait shows "Rotate the device"; landscape shows the game.
- [ ] Touch controls visible: steering pad (left), STEAM, GEAR −, VENT, weapons, cards, reposition, pause.
- [ ] Drag on the left half steers; release recentres. Multi-touch: steer and press STEAM at the same time.
- [ ] Holding GEAR − brakes, then reverses.
- [ ] Pause button (II) pauses; tap the overlay to resume.
- [ ] Badge shows the backend and fps; on a mid-range 2021 phone the tier is `medium` and fps ≈ 30 or more.
- [ ] `?debug` panel starts collapsed and does not block the touch controls when collapsed.
- [ ] Install as PWA from a production build (`npm run build && npm run preview`): opens fullscreen in landscape.

## M1 — Look test

Compare against `refs/engine/engine (1).jpg` and `engine (4).jpg` (doc 02 §16). Use `?debug`, group **showcase → Camera follows: rival** to watch the demo tank drive the loop.

### PC (WebGPU)

- [ ] Outlines on vehicles, barriers, props; vehicle silhouettes thicker. No outlines around smoke/steam.
- [ ] Hatching visible in shadowed areas (barrier and furnace shadows), strokes stay fixed on surfaces while the camera moves (no swimming, no redraw animation).
- [ ] Furnace mouths flicker, neon signs glow with bloom and drop out occasionally, vehicle runes pulse.
- [ ] Steam from vents (white), smoke from chimneys and vehicle stacks (dark), more exhaust at higher speed.
- [ ] Plates with rivets and seams, grates, rust readable at gameplay distance.
- [ ] `post → Post debug view`: grayscale shows track mid-grey, ground darker, vehicles brightest (§13).
- [ ] Debug views work: normals, depth, edges, objectId, noPost; `ink → Material debug view`: albedo, lighting, hatchTone.
- [ ] `lines → Hand-drawn wobble` Off/Low changes line shape, never animates.
- [ ] Quality tiers Low → Ultra switch at runtime (Low: no hatching, no shadow map).
- [ ] Frame rate ≥ 60 fps at High, 1080p, mid GPU.
- [ ] R (Reposition) puts the car back on the track.

### Phone

- [ ] Same look at Medium tier, ≥ 30 fps stable on a mid-range 2021 phone.
- [ ] First load: shader warm-up time (console `[render] shaders compiled in … ms`) acceptable (< 10 s).

## M2 — Driving prototype

Goal (doc 03 §18): fun to drive 3 laps alone on desktop and phone. Rivals are autopilots (`?racers=1` to drive alone).

### PC

- [ ] Countdown 3-2-1, cars held on the grid, gears frozen until GO.
- [ ] Car drives itself in 1st; ↑ (steam push) shifts up with a burst of speed and extra smoke; ↓ tap shifts down, hold brakes then reverses.
- [ ] Steering feels responsive at low speed and calmer at high speed; hard steering at speed makes the rear slide (drift + dust).
- [ ] Grates slightly less grip; the dirt section is slower and kicks up dust.
- [ ] Walls stop the car without launching it; contact with rivals pushes, never flips.
- [ ] R repositions on the track; a flipped or stuck car is repositioned automatically after ~2.5 s.
- [ ] Wrong way warning when driving backwards.
- [ ] HUD: position x/4, lap x/3, lap time, best lap, leaderboard; FINISH banner and results; Enter / steam push / button restarts.
- [ ] Camera follows the track calmly through the chicanes (tune `showcase → Camera: track tangent vs heading`).
- [ ] Gamepad: same, with analog steering.
- [ ] `?players=2`: both players race with their own camera and HUD.
- [ ] Tune `handling.*` and `gearbox.*` in `?debug`, export JSON, check it with `npx tsx tools/sim/run.ts --preset file.json`.

### Phone

- [ ] Touch: steering pad + STEAM + GEAR − are enough to complete 3 laps.
- [ ] ≥ 30 fps during the race at Medium.

## Driver feedback — gear + steam under the vehicle

Fed by the real boiler since M3 (rules/boiler.ts; CAL per vehicle in `stats.*`, ignition 2 PV, 1 PV every 1.5 s below CAL).

- [ ] Under the player's vehicle: brass gear number on the left, then CAL steam squares. Lit orange = spendable; grey = push cooling down; dark = empty, the next one fills up grey while it regenerates.
- [ ] With 0 PV the push does not fire and the gear does not change.
- [ ] `?debug` → set `boiler.startPv` above CAL and reload: extra squares on the right are red.
- [ ] Gear 5–6 shown in red, as on the HUD plate.
- [ ] Touch: the STEAM button perimeter shows the same squares as arcs; the button border/label dims while the push is not usable.
- [ ] `?players=2`: each player has its own tag under its own vehicle.
- [ ] `hud.vehicleTag` (debug) hides the tag; `hud.tagOffset` moves it.

### Corner warning (above the vehicle)

- [ ] `?track=foundry-01`: after the start straight a tag above the vehicle shows an S turning left, two chevrons, an advised gear; its bar fills while approaching.
- [ ] Entering the first bend of the S, the tag switches to the right bend still to come; past it, it hides.
- [ ] Wide (arc, brass), tight (90° arrow, orange) and hairpin (U, red) icons; left turns are mirrored.
- [ ] Above the advised gear the number blinks red; scaling down to it turns it back to brass.
- [ ] No tag in the countdown, when stopped, reversing or going the wrong way.
- [ ] Phone (or vehicle high on screen): the tag moves under the gear + steam tag instead of covering the HUD.
- [ ] `?players=2`: each player has its own corner tag. `hud.cornerTag` (debug) hides it; `hud.cornerLead` changes how early it appears.
- [ ] Desktop: the tag stays above the vehicle unless the vehicle is right under the HUD strip.
- [ ] Chevron boards on the outside of tight bends (2 orange) and hairpins (3 red), none on wide bends; the chevrons point the way of the turn whether the camera sees the front or the back.
- [ ] `world.cornerBoards` off + restart: no boards.
- [ ] Editor → Show tileset (`foundry-01`): the module before each corner has a sign on the road (icon + chevrons in the severity colour), top towards the travel arrow; the first one sits between the start line and the S, not on the line.

## M3 — Race vertical slice

Goal (doc 03 §18): complete 3-lap race vs 3 AI at target FPS on both device classes. Values are placeholders (doc 03 §19, A7): tune them in `?debug` (groups `stats`, `start`, `boiler`, `hull`, `weapons`, `ai`) and check with `npx tsx tools/sim/run.ts --preset file.json --seed N`.

### PC

- [ ] Countdown: the start meter appears; holding ↑ raises the needle, releasing lowers it. Keeping it in the green → PERFECT START (3rd gear + long push); partly → GOOD START (2nd); never touching ↑ or holding it into the red → STALLED.
- [ ] Grid: cars spaced enough that the start is not a pile-up.
- [ ] For ~2.5 s after GO nobody pushes. Weapons start cold (HUD "COLD · GEAR 6 / LAP 2", "BOILER COLD" banner at GO). Reaching 6th gear shows "BOILER HOT: WEAPONS ARMED!" and the cannon stays armed after shifting down; staying below 6th, the weapons arm at the end of lap 1 instead. Same rule for the AI. The pause controls list the warm-up next to the cannon.
- [ ] Boiler box in the HUD: 2 × CAL cells, right half red; the vehicle tag pips match it. Hoarding steam above CAL fills the pressure bar; when full the boiler stalls: a red half ring appears on the ground under the vehicle (camera side, needle sweeping left to right, "GEAR ON THE GREEN") and the old centre bar is gone. ↑ or ↓ on the green notch → PRESSURE CONTAINED (ring flashes green); during the stall ↑/↓ never shift gear or push, holding ↓ still brakes, a tap in the first 0.2 s is ignored; missed → EMERGENCY VALVES (−3 gears, 1 PF). At 2 × CAL: valves give (hard brake, 2 PF) or BOILER EXPLODED (stall, CAL −2, half PF, shock wave pushes nearby cars).
- [ ] `/` (the `-` key on an Italian layout) or Num 0 outside a test vents 1 PV and leaves a steam cloud (P2: Q); it does nothing during a test. Pressing Shift repeatedly no longer triggers Windows Sticky Keys during a race.
- [ ] Split screen: each player sees only their own valve ring.
- [ ] Downshifting from 4th up gives 1 PV back.
- [ ] Hull box: PF bar, orange under 50 % (engine smokes), red and flashing under 25 % (fire sparks). Edge hits cost PF per barricade (riveted/corrugated on hits, hedgehogs more and while scraping, barbed wire never).
- [ ] Ramming a rival nose-first at speed: sparks, RAM WON for the winner, both usually lose PF; side contacts at speed cost 1 PF each.
- [ ] Cannon: a reticle appears on the rival ahead (dashed = locking, solid = locked; its size is the cone). Right Ctrl / `.` fires: tracer, CENTRE HIT / VITAL HIT / HIT / GRAZED banners, shells counter goes down (+1 per lap). Steering, high gears and vent clouds make the reticle bigger.
- [ ] A rival locking you shows UNDER FIRE with an arrow towards it.
- [ ] Barricades block shots: no lock and no hits across the inside of a curve; a shell that clips a barricade sparks on it ("BLOCKED BY THE BARRICADE").
- [ ] Pause (Esc / P / Start / II): the controls table (keyboard, P2 in split screen, gamepad, touch on phones).
- [ ] Wreck at 0 PF: stops on the track as an obstacle, struck out in the leaderboard; if it is you, results after ~3 s with RETIRED.
- [ ] AI: they start (mostly well), overtake around slower cars, shoot, vent; a full race ends with 4 results (some may be retired).
- [ ] Minimap top right: track outline, one dot per racer in its colour, yours ringed, wrecks crossed out.
- [ ] Results update while the AI finish; Enter restarts.
- [ ] `?players=2`: both halves rendered with the ink look (outlines, hatching), each with its own HUD, start meter, boiler test and reticle; minimap centred on the right; ≥ 60 fps on the reference PC.
- [ ] Gamepad: B vents, RB fires.

### Phone

- [ ] Touch: VENT and FIRE buttons work; the start meter and the boiler test are readable above the controls.
- [ ] Nothing overlaps in landscape (browser window and fullscreen): HUD column top left, steer pad bottom left, minimap top right, ⟲ / VENT / FIRE above GEAR − / STEAM, pause II top centre, start meter and boiler test bottom centre. The leaderboard is hidden on short screens.
- [ ] The gear + steam tag stays centred under the car through every bend, and is always below overlays (pause, results, loading).
- [ ] Complete 3-lap race vs 3 AI at ≥ 30 fps (Medium).

## M4 phase A — Biomes, track v2, crates, hazards, jumps

Goal (doc 04 §3 A): the foundations of the Cup work on a test track. Open `?track=proving-ground` (add `&debug` for the tunables groups `pickups`, `jumps`, `hazards`).

### PC

- [ ] `foundry-01` looks and plays as before (furnaces, signs, catwalk, molten pool, hall; console: `[world] foundry: dressing 3356 instances`).
- [ ] Proving ground: the road climbs a ramp onto flagstones (stone parapet left, rune pylons right with a cyan arc; scraping the pylons shows RUNE PYLON: −1 PV).
- [ ] Jump down a level over a lava pit: in 4th–5th the car clears it (CLEAN LANDING +1 PV); too slow → falls in the pit and is put back after the landing.
- [ ] Canal-bridge crest on cobbles: the car goes light on top; the camera follows the height smoothly.
- [ ] Money bags on the bridge: +$5,000 banner, `$` box appears in the HUD strip; crates come back after ~8 s.
- [ ] Level crossing: lamps blink and barriers drop (cars slowed), then a train crosses: anyone on the rails crashes (TRAIN!: CRASH, −3 PF). The AI waits for it.
- [ ] Sap stream on the heartwood: the cyan lane pulses; driving on it during the pulse gives PV, between pulses it is slippery.
- [ ] Second jump on sand between tyre walls, then the forge vent grate: it glows, then fire jets (−1 PF, +1 PV if you cross while active).
- [ ] Magnet crane on the scrap straight: the shadow grows, the block drops on the left half of the road and blocks it for ~6 s; the AI passes on the right.
- [ ] A full 3-lap race vs 3 AI finishes (some may be wrecked) with no car stuck.

### Phone

- [ ] Proving ground runs at ≥ 30 fps (Medium); crates, hazard glows and jump pits readable.

## M4 phase B — Front-end, Cup, workshop, difficulty

Goal (doc 04 §3 B, §10): a full Cup from the title to the trophy. Open the game with no flags (`?laps=1` for faster runs).

### PC

- [ ] Title shows Grand Prix and Single race; arrows/WASD move, Enter/Space pick, Esc goes back a step; a gamepad works the same (d-pad, A, B); the mouse highlights the item under it.
- [ ] Grand Prix → 1 player → Normal → Hot Rod → briefing of *Runegate Deep* (world, hazard, grid draw, "stand-in layout" note).
- [ ] Race → results show prize per position, money bags and repair for wrecks → Continue → Cup standings → Workshop.
- [ ] Workshop: buying a level lowers the cash, fills a pip, the price grows; MAX after 4; buttons grey out when too expensive. Next race → briefing 2 with the grid in standings order (leader on pole).
- [ ] The car with Top speed / Acceleration levels is visibly faster on the straights / out of corners.
- [ ] Close the tab between races, reopen: Continue Cup resumes at the same point (workshop or briefing).
- [ ] Pause in a Cup race: Resume, Retire (results: you are RETIRED, no prize, no repair), Quit to title (the race is not counted, Continue resumes at its briefing).
- [ ] After race 4: standings → Trophy → Back to title; Continue Cup is gone.
- [ ] 2 players: both choose a vehicle; the workshop has one turn per player; split screen races.
- [ ] Easy vs Hard: rivals clearly slower / faster, Hard rivals upgrade more over the Cup.
- [ ] Single race: track choice, random grid, Pause → Restart works, results → Race again / Title.

### Phone

Automated: `npm run test:phone:cup -- --adb … --serial IP:PORT` taps through the menus with real touch events (CDP), races Cup race 1 on autopilot, buys an upgrade, starts race 2 without a reload, quits from the touch pause menu and resumes the saved Cup after a reload. Prints FPS, load times, JS heap and layout checks (main button visible without scrolling, touch targets ≥ 40 px); screenshots `tools/phone/out/cup-*.png`.

- [x] Menus are tappable and fit in landscape (no players step); the main button of every screen stays on screen. *(2026-11-14, see results below)*
- [x] A Cup can be saved and resumed after a reload (quit mid-race → back at that race's briefing). *(2026-11-14; reload, not a PWA restart)*
- [ ] Feel by hand: reading the briefing and workshop with a thumb, scrolling the standings, a full 4-race Cup in the installed PWA.

**Results 2026-11-14** — Realme RMX3370 (Snapdragon 870, Chrome, WebGPU, Medium tier), dev server over `adb reverse`, Chrome tab with the URL bar (viewport 719 × 267 px, `?fullscreen=0`):

| Check | Result |
|---|---|
| Quick race (`test:phone`) | ready in 12.9 s (shader warm-up 12.0 s), FPS min 49 / p10 50 / median 54, STEAM touch button shifts up, no console errors |
| Title | interactive 1.3–1.5 s after load (the 3D race is built only when a race starts) |
| Cup race 1 / race 2 | ready in 13.2–13.3 s / 10.7–11.0 s (second warm-up shorter: shader cache), FPS median 50–52 / 54, min 43–45 / 49–50 |
| Memory between races | JS heap 72 MB before race 1, after it, on the menus, during race 2 and after quitting: no JS leak (GPU memory is not measurable from the page) |
| Touch flow | Grand Prix → difficulty → vehicle → briefing → race → results → standings → workshop (Buy spent $20,000) → race 2 → pause (II) → quit → reload → Continue Cup ("Race 2 of 4") → briefing of race 2: all OK, no errors |
| Players step | not shown on the phone (split screen is PC only) ✓ |
| **Found and fixed** | at 267 px height the main button (Start race, Continue, Next race) was below the fold on briefing, results, standings and workshop; workshop Buy buttons were 33 px tall; the results table wrapped "best" and "PF" on two lines. Now: the action row is sticky at the bottom of the card, touch buttons are ≥ 44 px, best lap and PF columns are hidden on short screens. Re-run: no layout issues. |
| Still open | ~11–13 s loading card before every Cup race on this phone (whole-world shader warm-up per race); worth a progress bar or a shared shader cache in phase D2 |

## M4 phase C — The four worlds

Goal (doc 04 §3 C, §11): each Cup world recognisable in one screenshot, raceable, readable. Open a world directly with `?quick&track=<id>` or play the Cup from the title.

### PC

- [ ] `?quick&track=runegate-deep`: dark stone hold, cold light from above, braziers, colonnade, rune pylons (cyan arcs), ore carts; the road (light flagstones) reads against the rock floor. Forge grate bridge over the magma channel: the vent glows, then fire. Rune Engine (magenta core, gears) inside the hairpin. Two ramps down, a long ramp back up.
- [ ] `?quick&track=cinderholme-station`: wet cobbles, drizzle, gas lamps and light pools, brick terraces with lit windows, bunting over the road, crowd stands with the crest. Humped canal bridge (cars go light), railway cutting with the level crossing (bells, barriers, train). Grand Station with the clock rose window at the finish.
- [ ] `?quick&track=rustmaw-pit`: dusty warm light (not a single orange), tusk arch at the start, scrap towers with neon sigils, cranes, furnaces with black smoke. Jump on the main straight, long jump off the wreck ramp, mud pit. Magnet crane hazard: tower on the far side of the road. Warlord idol.
- [ ] `?quick&track=lirael-canopy`: rain, glowing canopies beside (never over) the road, rune banners, crystal barricades, mushrooms. Sap stream lanes follow the road through the curve. Mother Tree inside the climbing curve, jump over the mist gap.
- [ ] In all four: no tall object hides the road or the cars from the board camera; no props on the road; no errors in the console.
- [ ] Single race lists the four worlds; a full Cup goes Runegate → Cinderholme → Rustmaw → Lirael with no stand-in note on the briefing.
- [ ] Back to `?quick` (foundry) after a world: the foundry looks as before (palette not inherited).
- [ ] Low tier: no rain, still readable.

### Phone

- [ ] Each world at medium tier: FPS, loading time and readability (doc 04 D2).
