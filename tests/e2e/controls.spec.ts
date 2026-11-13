import { expect, test } from '@playwright/test';
import { boot, snapshot } from './helpers';

const gear = async (page: import('@playwright/test').Page, p = 0) => (await snapshot(page)).players[p]!.gear;

test.describe('keyboard (PC)', () => {
  test.skip(({ isMobile }) => isMobile, 'PC only');

  test('P1 arrows: steer turns, steam push shifts up, gear down shifts down', async ({ page }) => {
    await boot(page, 'tier=low');
    // Steering first, on the start straight (later the car reaches the chicane walls).
    const h0 = (await snapshot(page)).players[0]!.heading;
    await page.keyboard.down('ArrowRight');
    await expect.poll(async () => (await snapshot(page)).players[0]!.heading).toBeLessThan(h0 - 0.05);
    await page.keyboard.up('ArrowRight');
    expect((await snapshot(page)).players[0]!.device).toBe('keyboard');

    await page.keyboard.press('ArrowUp');
    await expect.poll(() => gear(page)).toBe(2);
    // Wait for the push cooldown in simulated time (the sim slows down when the page is starved).
    await expect.poll(async () => (await snapshot(page)).players[0]!.pushCooldown).toBe(0);
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => gear(page)).toBe(3);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => gear(page)).toBe(2);
  });

  test('Escape pauses and resumes', async ({ page }) => {
    await boot(page, 'tier=low');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pause-overlay')).toBeVisible();
    const s1 = (await snapshot(page)).simSteps;
    await page.waitForTimeout(300);
    expect((await snapshot(page)).simSteps).toBe(s1);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pause-overlay')).toHaveCount(0);
  });

  test('split screen: WASD drives P2, arrows drive P1', async ({ page }) => {
    await boot(page, 'players=2&tier=low');
    await page.keyboard.press('KeyW');
    await expect.poll(() => gear(page, 1)).toBe(2);
    expect(await gear(page, 0)).toBe(1);
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => gear(page, 0)).toBe(2);
  });
});

test.describe('gamepad (PC)', () => {
  test.skip(({ isMobile }) => isMobile, 'PC only');

  test('A button shifts up through the Gamepad API', async ({ page }) => {
    // Mock a standard-mapping pad; the test flips button 0 via window.__pad.
    await page.addInitScript(() => {
      const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
      const pad = { id: 'mock', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons, timestamp: 0 };
      (window as unknown as { __pad: typeof pad }).__pad = pad;
      Object.defineProperty(navigator, 'getGamepads', { value: () => [pad, null, null, null] });
    });
    await boot(page, 'tier=low');
    await page.evaluate(() => {
      const w = window as unknown as { __pad: { buttons: { pressed: boolean; value: number }[] } };
      w.__pad.buttons[0] = { pressed: true, value: 1 };
    });
    await expect.poll(() => gear(page)).toBe(2);
    await page.evaluate(() => {
      const w = window as unknown as { __pad: { buttons: { pressed: boolean; value: number }[] } };
      w.__pad.buttons[0] = { pressed: false, value: 0 };
    });
    expect((await snapshot(page)).players[0]!.device).toBe('gamepad');
  });
});

test.describe('touch (mobile)', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile only');

  test('touch controls are shown and drive the vehicle', async ({ page }) => {
    await boot(page, 'tier=low');
    await expect(page.getByTestId('touch-controls')).toBeVisible();

    await page.getByTestId('touch-steamPush').tap();
    await expect.poll(() => gear(page)).toBe(2);
    expect((await snapshot(page)).players[0]!.device).toBe('touch');

    await page.getByTestId('touch-gearDown').tap();
    await expect.poll(() => gear(page)).toBe(1);
  });

  test('steering pad drag steers right', async ({ page }) => {
    await boot(page, 'tier=low');
    const pad = page.getByTestId('touch-steer');
    const box = (await pad.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const h0 = (await snapshot(page)).players[0]!.heading;
    // Pointer events with touch type (CDP touch is not routed as pointer drag by Playwright's mouse).
    await pad.dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, isPrimary: true });
    await pad.dispatchEvent('pointermove', { pointerId: 7, pointerType: 'touch', clientX: x + 80, clientY: y, isPrimary: true });
    await page.waitForTimeout(600);
    await pad.dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', clientX: x + 80, clientY: y, isPrimary: true });
    expect((await snapshot(page)).players[0]!.heading).toBeLessThan(h0);
  });
});
