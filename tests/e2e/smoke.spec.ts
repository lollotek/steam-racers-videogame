import { expect, test } from '@playwright/test';
import { boot, isMobileProject, snapshot } from './helpers';

test('boots, renders and runs the fixed-step simulation without errors', async ({ page }) => {
  const errors = await boot(page);
  const a = await snapshot(page);
  expect(['webgpu', 'webgl2']).toContain(a.backend);
  await page.waitForTimeout(1000);
  const b = await snapshot(page);
  expect(b.simSteps - a.simSteps).toBeGreaterThan(20); // ~60/s in real time
  expect(b.players[0]!.speed).toBeGreaterThan(0); // gear-based: drives by itself in 1st
  await expect(page.locator('#game-canvas')).toBeVisible();
  await expect(page.getByTestId('hud-p1')).toBeVisible();
  expect(errors).toEqual([]);
});

test('track format v2: the proving ground (heights, jumps, crates, hazards) boots and runs', async ({ page }) => {
  const errors = await boot(page, 'track=proving-ground');
  const a = await snapshot(page);
  await page.waitForTimeout(1000);
  const b = await snapshot(page);
  expect(b.simSteps - a.simSteps).toBeGreaterThan(20);
  await expect(page.getByTestId('hud-p1')).toBeVisible();
  expect(errors).toEqual([]);
});

test('forced WebGL2 fallback works', async ({ page }) => {
  const errors = await boot(page, 'backend=webgl2');
  expect((await snapshot(page)).backend).toBe('webgl2');
  expect(errors).toEqual([]);
});

test('debug panel opens only with ?debug and lists tunables', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#debug-panel')).toHaveCount(0);
  await boot(page, 'debug');
  const panel = page.locator('#debug-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Steam Racers · debug');
});

test('split screen renders two HUDs on PC and is disabled on mobile', async ({ page }, info) => {
  await boot(page, 'players=2');
  const s = await snapshot(page);
  if (isMobileProject(info.project.name)) {
    expect(s.players).toHaveLength(1);
    await expect(page.getByTestId('hud-p2')).toHaveCount(0);
  } else {
    expect(s.players).toHaveLength(2);
    await expect(page.getByTestId('hud-p2')).toBeVisible();
  }
});
