# Manual Test Checklist

> Run per milestone on **PC** (keyboard + gamepad) and on a **real phone** (touch).
> Automated coverage: `npm run test` (unit) and `npm run test:e2e` (Playwright, desktop + emulated mobile).
> Headless Chromium has no WebGPU, so the automated runs exercise the WebGL2 fallback; WebGPU is verified here by hand.

## Setup

- Dev server reachable from the phone: `npm run dev` prints a LAN URL (`--host` is on). Phone and PC on the same network.
- WebGPU needs a secure context: `localhost` is fine on PC; from the phone use the HTTPS preview build or a tunnel.
- **Automated real-phone run (Android):** `npm run test:phone -- --adb D:\programmi\scrcpy-win64-v3.3.4\adb.exe --serial IP:PORT` drives Chrome on the phone over ADB (Playwright): WebGPU backend, boot/warm-up time, FPS during an autopilot lap at Medium, STEAM touch button, console errors, screenshots in `tools/phone/out/`. One-time setup: Developer options → Wireless debugging → Pair device with pairing code, then `adb pair IP:PAIR_PORT CODE`; the connect port is shown on the same screen. `adb reverse` serves the PC dev server as the phone's `localhost` (secure context: WebGPU without HTTPS). Feel, readability and real touch handling still need a human.
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

## M3 — Race vertical slice

Goal (doc 03 §18): complete 3-lap race vs 3 AI at target FPS on both device classes. Values are placeholders (doc 03 §19, A7): tune them in `?debug` (groups `stats`, `start`, `boiler`, `hull`, `weapons`, `ai`) and check with `npx tsx tools/sim/run.ts --preset file.json --seed N`.

### PC

- [ ] Countdown: the start meter appears; holding ↑ raises the needle, releasing lowers it. Keeping it in the green → PERFECT START (3rd gear + long push); partly → GOOD START (2nd); never touching ↑ or holding it into the red → STALLED.
- [ ] Grid: cars spaced enough that the start is not a pile-up.
- [ ] For ~2.5 s after GO nobody pushes. Weapons are locked during lap 1 (HUD "CANNON LOCKED · LAP 2", banner at GO); at the end of lap 1 "WEAPONS ARMED!" appears, for the AI too.
- [ ] Boiler box in the HUD: 2 × CAL cells, right half red; the vehicle tag pips match it. Hoarding steam above CAL fills the pressure bar; when full, "VENT ON THE GREEN!" appears: Right Shift on the green notch → PRESSURE CONTAINED; missed → EMERGENCY VALVES (−3 gears, 1 PF). At 2 × CAL: valves give (hard brake, 2 PF) or BOILER EXPLODED (stall, CAL −2, half PF, shock wave pushes nearby cars).
- [ ] Right Shift outside a test vents 1 PV and leaves a steam cloud.
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
- [ ] HUD strip fits in landscape without covering the minimap / leaderboard.
- [ ] Complete 3-lap race vs 3 AI at ≥ 30 fps (Medium).

