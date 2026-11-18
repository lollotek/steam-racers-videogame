import { expect, test } from '@playwright/test';
import { boot, isMobileProject, snapshot } from './helpers';

type Hook = { __steamRacers: { tunables: { set(k: string, v: unknown): void } } };

test('M2 race: countdown, HUD, one lap on autopilot, results and restart', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await boot(page, 'laps=1&tier=low');
  // Phones (short landscape screens) hide the leaderboard: the position is in the HUD.
  if (isMobileProject(test.info().project.name)) {
    await expect(page.getByTestId('leaderboard')).toBeHidden();
    await expect(page.getByTestId('minimap')).toBeVisible();
  } else await expect(page.getByTestId('leaderboard')).toBeVisible();
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

test('M3 rules: start test meter, hull / cannon / boiler HUD, minimap, firing spends a shell', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await boot(page, 'tier=low');
  // Start test: visible only during the countdown.
  await page.evaluate(() => {
    const h = (window as unknown as Hook & { __steamRacers: { game: { startRace(): void } } }).__steamRacers;
    h.tunables.set('race.countdown', 8);
    h.tunables.set('weapons.unlockLap', 0); // armed from GO, to test firing without driving a lap
    h.game.startRace();
  });
  await expect(page.getByTestId('start-test-p1')).toBeVisible();
  await expect(page.getByTestId('hull-p1')).toBeVisible();
  await expect(page.getByTestId('boiler-p1')).toBeVisible();
  await expect(page.getByTestId('ammo-p1')).toBeVisible();
  await expect(page.getByTestId('minimap')).toBeVisible();
  await expect(page.getByTestId('pf-p1')).toHaveText('20');
  // Pause shows the controls reference.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('controls-help')).toBeVisible();
  await expect(page.getByTestId('controls-help')).toContainText('Right Shift');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-overlay')).toHaveCount(0);
  await expect.poll(async () => (await snapshot(page)).players[0]!.start, { timeout: 60_000 }).not.toBeNull();
  await expect(page.getByTestId('start-test-p1')).toBeHidden();
  // After the calm time the front cannon fires (one shell), target or not.
  await expect.poll(async () => (await snapshot(page)).clock, { timeout: 60_000 }).toBeGreaterThan(3);
  const ammo = (await snapshot(page)).players[0]!.ammo;
  await page.keyboard.down('ControlRight');
  await page.waitForTimeout(150);
  await page.keyboard.up('ControlRight');
  await expect.poll(async () => (await snapshot(page)).players[0]!.ammo).toBe(ammo - 1);
  expect(errors).toEqual([]);
});

test('corner tag: warns of the next corner above the vehicle, with kind and advised gear', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors = await boot(page, 'track=foundry-01&tier=low');
  await page.evaluate(() => (window as unknown as Hook).__steamRacers.tunables.set('showcase.playerAutopilot', true));
  const tag = page.getByTestId('ctag-p1');
  // foundry-01 opens with an S (left, then right) after the start straight.
  await expect(tag).toBeVisible({ timeout: 60_000 });
  await expect(tag).toHaveAttribute('data-kind', 's');
  await expect(tag).toHaveAttribute('data-turn', 'L');
  await expect(page.getByTestId('ctag-p1-gear')).toHaveText(/^[1-6]$/);
  await page.screenshot({ path: info.outputPath('corner-tag.png') });
  // Then it is shown by itself again for the next corners.
  await expect(tag).toHaveAttribute('data-kind', 'wide', { timeout: 60_000 });
  expect(errors).toEqual([]);
});
