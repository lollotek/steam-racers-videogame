import { expect, test } from '@playwright/test';
import { boot, snapshot } from './helpers';

type Hook = { __steamRacers: { tunables: { set(k: string, v: unknown): void; reset(): void } } };

test('M1 look test: particles run and every debug view renders without errors', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await boot(page);
  expect((await snapshot(page)).particles).toBeGreaterThan(0);
  const views: [string, string][] = [
    ...['grayscale', 'normals', 'depth', 'edges', 'objectId', 'noPost', 'final'].map((v) => ['post.debugView', v] as [string, string]),
    ...['albedo', 'lighting', 'hatchTone', 'final'].map((v) => ['ink.debugView', v] as [string, string]),
    ['post.aa', 'smaa'],
    ['post.bloom', 'false'],
    ['lines.enabled', 'false'],
  ];
  for (const [key, value] of views) {
    await page.evaluate(([k, v]) => (window as unknown as Hook).__steamRacers.tunables.set(k!, v === 'false' ? false : v), [key, value]);
    const before = (await snapshot(page)).frames;
    await expect.poll(async () => (await snapshot(page)).frames, { timeout: 90_000 }).toBeGreaterThan(before + 3);
  }
  expect(errors).toEqual([]);
});

test('quality tiers switch at runtime (hatching / shadows)', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page);
  for (const tier of ['low', 'ultra', 'medium']) {
    await page.evaluate((t) => (window as unknown as Hook).__steamRacers.tunables.set('quality.tier', t), tier);
    await expect.poll(async () => (await snapshot(page)).tier, { timeout: 90_000 }).toBe(tier);
    const before = (await snapshot(page)).frames;
    await expect.poll(async () => (await snapshot(page)).frames, { timeout: 90_000 }).toBeGreaterThan(before + 3);
  }
  expect(errors).toEqual([]);
});
