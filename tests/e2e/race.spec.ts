import { expect, test } from '@playwright/test';
import { boot, snapshot } from './helpers';

type Hook = { __steamRacers: { tunables: { set(k: string, v: unknown): void } } };

test('M2 race: countdown, HUD, one lap on autopilot, results and restart', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await boot(page, 'laps=1&tier=low');
  await expect(page.getByTestId('leaderboard')).toBeVisible();
  await expect(page.getByTestId('lap-p1')).toHaveText('1');
  // Let the autopilot drive the player, simulation sped up (fixed step: same physics, more steps per frame).
  await page.evaluate(() => {
    const t = (window as unknown as Hook).__steamRacers.tunables;
    t.set('showcase.playerAutopilot', true);
    t.set('sim.timeScale', 3);
  });
  await expect.poll(async () => (await snapshot(page)).players[0]!.distance, { timeout: 60_000 }).toBeGreaterThan(50);
  await expect(page.getByTestId('results')).toBeVisible({ timeout: 240_000 });
  expect((await snapshot(page)).players[0]!.lap).toBe(1);
  await page.getByTestId('restart').click();
  await expect(page.getByTestId('results')).toHaveCount(0);
  await expect.poll(async () => (await snapshot(page)).phase).toBe('countdown');
  expect(errors).toEqual([]);
});
