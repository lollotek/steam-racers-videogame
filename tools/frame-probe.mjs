// Dev helper: frame-time hitches at race start and after a restart (needs a dev server).
// Usage: node tools/frame-probe.mjs [port=5173] [query="backend=webgl2"] [seconds=10]
// Prints every frame slower than 34 ms after the game started, with the game phase/clock.
import { chromium } from '@playwright/test';
const port = process.argv[2] ?? '5173';
const query = process.argv[3] ?? 'backend=webgl2';
const seconds = Number(process.argv[4] ?? 10);
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' || t.startsWith('[')) console.log('console:', t.slice(0, 200));
});
await page.addInitScript(() => {
  const rec = (window.__frames = []);
  let last = performance.now();
  const tick = (t) => {
    const g = window.__steamRacers;
    if (g) {
      const s = g.game.sim;
      rec.push({ ms: t - last, phase: s.phase, clock: s.clock, frame: g.game.frames, scale: g.game.dynres.scale });
    }
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const report = async (label) => {
  const frames = await page.evaluate(() => window.__frames.splice(0));
  const ms = frames.map((f) => f.ms).sort((a, b) => a - b);
  const slow = frames.filter((f) => f.ms > 34);
  console.log(`\n== ${label}: ${frames.length} frames, median ${ms[ms.length >> 1]?.toFixed(1)} ms, p99 ${ms[Math.floor(ms.length * 0.99)]?.toFixed(1)} ms, hitches(>34ms) ${slow.length}, lost ${slow.reduce((a, f) => a + f.ms, 0).toFixed(0)} ms`);
  for (const f of slow.slice(0, 40)) console.log(`   frame ${f.frame} ${f.phase} clock=${f.clock.toFixed(2)} scale=${f.scale}  ${f.ms.toFixed(0)} ms`);
};
await page.goto(`http://localhost:${port}/?test${query ? `&${query}` : ''}`);
await page.waitForFunction(() => window.__steamRacers && window.__steamRacers.snapshot().frames > 2, null, { timeout: 120000 });
await page.waitForTimeout(seconds * 1000);
await report('first start');
await page.evaluate(() => window.__steamRacers.game.startRace());
await page.waitForTimeout(seconds * 1000);
await report('restart');
await page.evaluate(() => window.__steamRacers.game.startRace());
await page.waitForTimeout(seconds * 1000);
await report('second restart');
await browser.close();
