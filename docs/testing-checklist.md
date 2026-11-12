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
