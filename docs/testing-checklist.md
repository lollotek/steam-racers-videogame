# Manual Test Checklist

> Run per milestone on **PC** (keyboard + gamepad) and on a **real phone** (touch).
> Automated coverage: `npm run test` (unit) and `npm run test:e2e` (Playwright, desktop + emulated mobile).
> Headless Chromium has no WebGPU, so the automated runs exercise the WebGL2 fallback; WebGPU is verified here by hand.

## Setup

- Dev server reachable from the phone: `npm run dev` prints a LAN URL (`--host` is on). Phone and PC on the same network.
- WebGPU needs a secure context: `localhost` is fine on PC; from the phone use the HTTPS preview build or a tunnel.
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
