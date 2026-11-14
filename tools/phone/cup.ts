/**
 * Real-phone check of the M4 front-end and Cup flow (doc 04 §3 B, testing-checklist "M4 phase B").
 * Taps through the menus with real touch events (CDP Input.dispatchTouchEvent), races the first Cup
 * race on autopilot, goes through results / standings / workshop, starts race 2 without a reload
 * (one Game per race: load time, FPS and JS heap of the second race vs the first), quits from the
 * touch pause menu and resumes the saved Cup after a reload.
 *
 *   npm run dev
 *   npx tsx tools/phone/cup.ts --adb path/to/adb.exe --serial IP[:PORT] [--port 5173] [--seconds 20]
 *
 * Prints a JSON report; screenshots in tools/phone/out/cup-*.png.
 */
import type { CDPSession } from '@playwright/test';
import { arg, connectPhone, outDir } from './device';

const port = Number(arg('port', '5173'));
const seconds = Number(arg('seconds', '20'));
const phone = await connectPhone(port);
const { page } = phone;
const cdp: CDPSession = await page.context().newCDPSession(page);

type H = {
  __steamRacers?: {
    tunables: { set(k: string, v: unknown): void };
    snapshot(): { phase: string; tier: string; renderScale: number } | null;
  };
};
const report: Record<string, unknown> = { device: phone.model };
const issues: string[] = [];
const shot = (name: string) => page.screenshot({ path: `${outDir}cup-${name}.png` });

/** Real touch tap at the centre of an element. */
async function tap(testid: string): Promise<void> {
  const el = page.getByTestId(testid);
  await el.waitFor({ state: 'visible', timeout: 120_000 });
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  if (!b) throw new Error(`no box for ${testid}`);
  const p = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
  await page.waitForTimeout(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
}

/** Does the screen fit the viewport (no clipping; scrolling allowed only inside the screen)? */
async function layout(testid: string): Promise<Record<string, unknown>> {
  const r = await page.evaluate((id) => {
    const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const card = el?.querySelector<HTMLElement>('.menu-card, .panel') ?? el;
    const vw = innerWidth;
    const vh = innerHeight;
    const cr = card?.getBoundingClientRect();
    // Buttons smaller than ~40 px are hard to hit with a thumb.
    const small = Array.from(el?.querySelectorAll<HTMLElement>('[data-nav]') ?? [])
      .map((b) => b.getBoundingClientRect())
      .filter((rr) => rr.height < 40 || rr.width < 40).length;
    // The main action of the screen must be reachable without scrolling.
    const main = el?.querySelector<HTMLElement>('[data-autofocus]')?.getBoundingClientRect();
    return {
      primaryVisible: main ? main.top >= 0 && main.bottom <= vh + 1 : null,
      vw,
      vh,
      card: cr ? { w: Math.round(cr.width), h: Math.round(cr.height) } : null,
      scrolls: el ? el.scrollHeight > el.clientHeight + 1 || (card ? card.scrollWidth > card.clientWidth + 1 : false) : false,
      overflowX: cr ? cr.width > vw + 1 : false,
      smallTargets: small,
    };
  }, testid);
  if (r.overflowX) issues.push(`${testid}: wider than the screen`);
  if (r.primaryVisible === false) issues.push(`${testid}: main button below the fold`);
  if ((r.smallTargets as number) > 0) issues.push(`${testid}: ${r.smallTargets} buttons under 40 px`);
  return r;
}

const heapMb = () => page.evaluate(() => {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? Math.round(m.usedJSHeapSize / 1e6) : null;
});

/** From "Start race" to the countdown running (world build + shader warm-up). */
async function raceReady(): Promise<number> {
  const t0 = Date.now();
  await page.waitForFunction(() => {
    const s = (window as unknown as H).__steamRacers?.snapshot();
    return !!s && !document.querySelector('[data-testid=loading]');
  }, null, { timeout: 240_000 });
  return (Date.now() - t0) / 1000;
}

async function sampleFps(n: number): Promise<{ min: number | null; median: number | null }> {
  const fps: number[] = [];
  for (let i = 0; i < n; i++) {
    await page.waitForTimeout(1000);
    const m = /(\d+) fps/.exec((await page.getByTestId('backend-badge').textContent()) ?? '');
    if (m) fps.push(Number(m[1]));
  }
  const s = [...fps].sort((a, b) => a - b);
  return { min: s[0] ?? null, median: s[Math.floor(s.length / 2)] ?? null };
}

const t0 = Date.now();
await page.goto(`http://localhost:${port}/?test&menu=1&laps=1&tier=medium&fullscreen=0`, { waitUntil: 'commit', timeout: 60_000 });
await page.waitForFunction(() => !!document.querySelector('[data-testid=title]'), null, { timeout: 240_000 });
await page.evaluate(() => localStorage.removeItem('steamRacers.cup.v1'));
await page.reload({ waitUntil: 'commit' });
await page.getByTestId('menu-grand-prix').waitFor({ timeout: 240_000 });
// The flow exists once the renderer is ready.
await page.waitForFunction(() => !!(window as unknown as { __steamRacers?: { flow?: unknown } }).__steamRacers?.flow, null, { timeout: 240_000 });
report.titleSeconds = (Date.now() - t0) / 1000;
await shot('1-title');
report.title = await layout('title');

await tap('menu-grand-prix');
report.playersStepShown = await page.getByTestId('menu-players-1').isVisible();
if (report.playersStepShown) issues.push('players step shown on a phone (split screen is PC only)');
await shot('2-difficulty');
report.difficulty = await layout('title');
await tap('menu-difficulty-normal');
await tap('menu-vehicle-hotrod');
await page.getByTestId('briefing').waitFor();
await shot('3-briefing');
report.briefing = await layout('briefing');

// Race 1.
const heap0 = await heapMb();
await tap('start-race');
const ready1 = await raceReady();
await page.evaluate(() => {
  const h = (window as unknown as H).__steamRacers!;
  h.tunables.set('showcase.playerAutopilot', true);
});
const fps1 = await sampleFps(seconds);
await shot('4-race1');
await page.evaluate(() => (window as unknown as H).__steamRacers!.tunables.set('sim.timeScale', 3));
await page.getByTestId('results').waitFor({ timeout: 300_000 });
await page.evaluate(() => (window as unknown as H).__steamRacers!.tunables.set('sim.timeScale', 1));
await page.waitForTimeout(800);
await shot('5-results');
report.results = await layout('results');
report.race1 = { readySeconds: ready1, fps: fps1, heapBeforeMb: heap0, heapEndMb: await heapMb() };

await tap('results-continue');
await page.getByTestId('standings').waitFor();
await shot('6-standings');
report.standings = await layout('standings');
await tap('standings-continue');
await page.getByTestId('workshop').waitFor();
const cashBefore = await page.getByTestId('workshop-cash').textContent();
await tap('buy-topSpeed');
const cashAfter = await page.getByTestId('workshop-cash').textContent();
report.workshopBuy = { before: cashBefore?.trim(), after: cashAfter?.trim(), ok: cashBefore !== cashAfter };
if (cashBefore === cashAfter) issues.push('workshop: tapping Buy did not spend money');
await shot('7-workshop');
report.workshop = await layout('workshop');
await tap('workshop-done');
await page.getByTestId('briefing').waitFor();
report.heapMenusMb = await heapMb();

// Race 2 without a reload: new track, previous race disposed.
await tap('start-race');
const ready2 = await raceReady();
await page.evaluate(() => (window as unknown as H).__steamRacers!.tunables.set('showcase.playerAutopilot', true));
const fps2 = await sampleFps(seconds);
await shot('8-race2');
report.race2 = { readySeconds: ready2, fps: fps2, heapMb: await heapMb() };

// Touch pause → Quit to title.
await page.evaluate(() => (window as unknown as H).__steamRacers!.tunables.set('showcase.playerAutopilot', false));
await tap('touch-pause');
await page.getByTestId('pause-overlay').waitFor();
await shot('9-pause');
report.pause = await layout('pause-overlay');
await tap('pause-title');
await page.getByTestId('title').waitFor();
report.heapAfterQuitMb = await heapMb();

// Reload: the Cup resumes at race 2 (the quit race is not counted).
await page.reload({ waitUntil: 'commit' });
await page.getByTestId('menu-continue').waitFor({ timeout: 240_000 });
report.continueLabel = (await page.getByTestId('menu-continue').textContent())?.trim();
await page.waitForFunction(() => !!(window as unknown as { __steamRacers?: { flow?: unknown } }).__steamRacers?.flow, null, { timeout: 240_000 });
await tap('menu-continue');
await page.getByTestId('briefing').waitFor();
report.resumedBriefing = (await page.locator('[data-testid=briefing] h1').textContent())?.trim();
await shot('10-resumed');
await page.evaluate(() => localStorage.removeItem('steamRacers.cup.v1'));

report.issues = issues;
report.errors = phone.errors;
report.renderLogs = phone.logs;
console.log(JSON.stringify(report, null, 2));
await cdp.detach().catch(() => {});
await phone.close();
