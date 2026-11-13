// Dev helper: capture look-test screenshots headless (needs `npm run dev` on :5173).
// Usage: node tools/shoot.mjs <outDir> [name='{"tunable.key": value, "__wait": ms}' ...]
// Headless Chromium on Windows falls back to WebGL2 (no dxcompiler), which is fine for look checks.
import { chromium } from '@playwright/test';
const [outDir, ...shots] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W || 1280), height: Number(process.env.H || 720) } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(m.type(), m.text().slice(0, 200)); });
await page.goto('http://localhost:5173/?test&seed=1');
await page.waitForFunction(() => window.__steamRacers && window.__steamRacers.snapshot().frames > 20, null, { timeout: 120000 });
console.log('backend', await page.evaluate(() => window.__steamRacers.snapshot().backend));
for (const spec of shots.length ? shots : ['final={}']) {
  const [name, json] = spec.split('=');
  const t = JSON.parse(json || '{}');
  await page.evaluate((t) => { const tu = window.__steamRacers.tunables; tu.reset(); for (const [k, v] of Object.entries(t)) tu.set(k, v); }, t);
  await page.waitForTimeout(t.__wait ?? 2500);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log('shot', name);
}
await browser.close();
