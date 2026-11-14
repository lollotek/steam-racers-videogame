import { expect, test, type Page } from '@playwright/test';
import { isMobileProject, snapshot } from './helpers';

/** Doc 04 B1/B2: title → setup → race through the menus (`?test&menu=1` keeps the menus). */
async function openTitle(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?test&menu=1&laps=1&tier=low');
  await page.evaluate(() => localStorage.removeItem('steamRacers.cup.v1'));
  await page.reload();
  await expect(page.getByTestId('title')).toBeVisible({ timeout: 90_000 });
  // The flow exists once the renderer is up.
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __steamRacers?: { flow?: unknown } }).__steamRacers?.flow), { timeout: 90_000 }).toBe(true);
}

async function pickPlayersIfAsked(page: Page, projectName: string): Promise<void> {
  if (!isMobileProject(projectName)) await page.getByTestId('menu-players-1').click();
}

test('Grand Prix: briefing, race, results with prizes, standings, workshop, next briefing, resume from save', async ({ page }, info) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await openTitle(page, errors);
  await page.getByTestId('menu-grand-prix').click();
  await pickPlayersIfAsked(page, info.project.name);
  await page.getByTestId('menu-difficulty-normal').click();
  await page.getByTestId('menu-vehicle-hotrod').click();
  await expect(page.getByTestId('briefing')).toContainText('Runegate Deep');

  await page.getByTestId('start-race').click();
  await expect.poll(async () => (await snapshot(page))?.phase ?? null, { timeout: 90_000 }).toBe('countdown');
  await page.evaluate(() => {
    const h = (window as unknown as { __steamRacers: { tunables: { set(k: string, v: unknown): void } } }).__steamRacers;
    h.tunables.set('showcase.playerAutopilot', true);
    h.tunables.set('sim.timeScale', 4);
  });
  await expect(page.getByTestId('results')).toBeVisible({ timeout: 240_000 });
  await expect(page.getByTestId('results')).toContainText('$100,000');
  await page.getByTestId('results-continue').click();

  await expect(page.getByTestId('standings')).toBeVisible();
  await expect(page.getByTestId('standing-1')).toContainText('$');
  await page.getByTestId('standings-continue').click();

  await expect(page.getByTestId('workshop')).toBeVisible();
  const before = await page.getByTestId('workshop-cash').textContent();
  await page.getByTestId('buy-accel').click();
  await expect(page.getByTestId('workshop-cash')).not.toHaveText(before ?? '');
  await page.getByTestId('workshop-done').click();
  await expect(page.getByTestId('briefing')).toContainText('Cinderholme Grand Station');
  await expect(page.getByTestId('briefing')).toContainText('Cup standings');

  // Saved: a reload offers Continue Cup, back at race 2.
  await page.reload();
  await expect(page.getByTestId('menu-continue')).toContainText('Race 2 of 4');
  await page.getByTestId('menu-continue').click();
  await expect(page.getByTestId('briefing')).toContainText('Cinderholme Grand Station');
  expect(errors).toEqual([]);
});

test('Single race: track pick, pause menu, back to the title', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  await openTitle(page, errors);
  await page.getByTestId('menu-single').click();
  await pickPlayersIfAsked(page, info.project.name);
  await page.getByTestId('menu-difficulty-easy').click();
  await page.getByTestId('menu-vehicle-tank').click();
  await page.getByTestId('menu-track-proving-ground').click();
  await expect.poll(async () => (await snapshot(page))?.phase ?? null, { timeout: 90_000 }).toBe('running');

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-overlay')).toBeVisible();
  await page.getByTestId('pause-title').click();
  await expect(page.getByTestId('title')).toBeVisible();
  expect(await snapshot(page)).toBeNull();
  expect(errors).toEqual([]);
});
