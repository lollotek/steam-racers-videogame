/**
 * Real-phone check over ADB (doc 03 §16): Chrome on an Android phone driven with Playwright, so
 * WebGPU, shader warm-up, FPS and touch are measured on the real device, not an emulation.
 *
 *   npm run dev   (or the preview build: npm run build && npx vite preview --port 4173)
 *   npx tsx tools/phone/run.ts [--adb path/to/adb.exe] [--serial 192.168.1.18[:PORT]] [--port 5173]
 *                              [--seconds 40] [--query tier=medium]
 *
 * Setup and connection: tools/phone/device.ts. Prints a JSON report; screenshots in tools/phone/out/.
 */
import { arg, connectPhone, openGame, outDir, type Hook } from './device';

const port = Number(arg('port', '5173'));
const seconds = Number(arg('seconds', '40'));
const query = arg('query', 'tier=medium');

const phone = await connectPhone(port);
const { page } = phone;
const snap = () => page.evaluate(() => (window as unknown as Hook).__steamRacers.snapshot());
const bootSeconds = await openGame(phone, port, `laps=1&${query}`);
await page.screenshot({ path: `${outDir}boot.png` });

// Let the autopilot race the player car and sample the FPS badge every second.
await page.evaluate(() => (window as unknown as Hook).__steamRacers.tunables.set('showcase.playerAutopilot', true));
const fps: number[] = [];
for (let i = 0; i < seconds; i++) {
  await page.waitForTimeout(1000);
  const badge = (await page.getByTestId('backend-badge').textContent()) ?? '';
  const m = /(\d+) fps/.exec(badge);
  if (m) fps.push(Number(m[1]));
  if (i === Math.floor(seconds / 2)) await page.screenshot({ path: `${outDir}race.png` });
}
await page.evaluate(() => (window as unknown as Hook).__steamRacers.tunables.set('showcase.playerAutopilot', false));

// Touch: the STEAM button shifts up (after a cooldown). An attached CDP context has no `hasTouch`,
// so touch pointer events instead of locator.tap().
const gear0 = (await snap()).players[0]!.gear as number;
await page.waitForTimeout(1500);
const steamBtn = page.getByTestId('touch-steamPush');
await steamBtn.dispatchEvent('pointerdown', { pointerId: 11, pointerType: 'touch', isPrimary: true });
await page.waitForTimeout(80);
await steamBtn.dispatchEvent('pointerup', { pointerId: 11, pointerType: 'touch', isPrimary: true });
await page.waitForTimeout(500);
const gear1 = (await snap()).players[0]!.gear as number;

const s = await snap();
const sorted = [...fps].sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      device: phone.model,
      backend: s.backend,
      tier: s.tier,
      renderScale: s.renderScale,
      bootSeconds,
      renderLogs: phone.logs,
      fps: { min: sorted[0] ?? null, p10: sorted[Math.floor(sorted.length * 0.1)] ?? null, median: sorted[Math.floor(sorted.length / 2)] ?? null, samples: fps },
      touchSteamPush: { before: gear0, after: gear1, ok: gear1 !== gear0 },
      errors: phone.errors,
    },
    null,
    2,
  ),
);
await phone.close();
