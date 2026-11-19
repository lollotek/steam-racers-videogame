import { expect, test } from '@playwright/test';
import { snapshot } from './helpers';

/** Race intro (game/race-intro.ts): off under ?test, forced on here with ?intro=1. */
test('race intro: fly-over holds the countdown, hides the HUD, a key skips to the race', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?test&intro=1&tier=low');
  await expect(page.getByTestId('intro')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('intro-caption')).toBeVisible();
  // The sim waits: the countdown clock does not move, the HUD and countdown are hidden.
  const before = await snapshot(page);
  await page.waitForTimeout(800);
  expect((await snapshot(page)).clock).toBe(before.clock);
  expect(before.phase).toBe('countdown');
  await expect(page.getByTestId('hud-p1')).toHaveCount(0);
  await expect(page.getByTestId('countdown')).toHaveCount(0);
  // Any key → hand-over → race camera, HUD back, countdown runs.
  await page.keyboard.press('Space');
  await expect(page.getByTestId('intro')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('hud-p1')).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).clock, { timeout: 30_000 }).toBeGreaterThan(before.clock);
  expect(errors).toEqual([]);
});
