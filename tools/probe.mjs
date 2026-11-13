// Dev helper: print game snapshots over time from a headless page (needs `npm run dev` on :5173).
// Usage: node tools/probe.mjs [seconds=10] [query=""] [tunables-json]
import { chromium } from '@playwright/test';
const seconds = Number(process.argv[2] ?? 10);
const query = process.argv[3] ?? '';
const browser = await chromium.launch({ args: ['--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('console.error', m.text().slice(0, 300));
});
await page.goto(`http://localhost:5173/?test${query ? `&${query}` : ''}`);
await page.waitForFunction(() => window.__steamRacers && window.__steamRacers.snapshot().frames > 5, null, { timeout: 120000 });
if (process.argv[4]) await page.evaluate((t) => { const tu = window.__steamRacers.tunables; tu.reset(); for (const [k, v] of Object.entries(t)) tu.set(k, v); }, JSON.parse(process.argv[4]));
for (let i = 0; i < seconds; i++) {
  const s = await page.evaluate(() => {
    const x = window.__steamRacers.snapshot();
    const p = x.players[0];
    return `results=${document.querySelectorAll('[data-testid=results]').length} frames=${x.frames} steps=${x.simSteps} paused=${x.paused} phase=${x.phase} clock=${x.clock.toFixed(2)} gear=${p.gear} v=${p.speed.toFixed(1)} lap=${p.lap} dist=${p.distance.toFixed(1)}`;
  });
  console.log(s);
  await page.waitForTimeout(1000);
}
await browser.close();
