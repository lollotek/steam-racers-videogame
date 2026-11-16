import { expect, test } from '@playwright/test';

/** Track editor (doc 05): page, standard tracks, live check, Play hand-off. Desktop only. */
test.describe('track editor', () => {
  test.skip(({ isMobile }) => isMobile, 'The editor is a PC tool');

  test('loads a standard track and hands it to the game', async ({ page, context }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/mapeditor');
    await expect(page).toHaveURL(/\/mapeditor\/$/);
    await expect(page.getByTestId('grid')).toBeVisible();

    await page.getByTestId('standard').selectOption('rustmaw-pit');
    await expect(page.getByTestId('report')).toContainText('The track is raceable');
    await expect(page.getByTestId('report')).toContainText('Cup rules');
    await expect(page.getByTestId('world')).toHaveValue('orc');

    // Switch world: the track stays raceable and the choice is autosaved.
    await page.getByTestId('world').selectOption('elven');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('steamRacers.editor.doc') ?? '{}').biome)).toBe('elven');

    const popup = context.waitForEvent('page');
    await page.getByTestId('play').click();
    const game = await popup;
    await expect(game).toHaveURL(/\?custom$/);
    const handed = await page.evaluate(() => JSON.parse(localStorage.getItem('steamRacers.customTrack') ?? 'null'));
    expect(handed).toMatchObject({ id: 'rustmaw-pit', biome: 'elven' });
    expect(handed.pieces.length).toBeGreaterThan(10);
    expect(handed.editor).toBeUndefined();
    await game.close();
    expect(errors).toEqual([]);
  });

  test('3D preview builds the world and follows edits', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/mapeditor/');
    await page.getByTestId('standard').selectOption('foundry-01');
    await page.getByTestId('preview-toggle').click();
    await expect(page.getByTestId('preview-canvas')).toBeVisible();
    await expect(page.getByTestId('preview-state')).toContainText('drag to orbit', { timeout: 30_000 });
    const built = () => page.evaluate(() => (window as unknown as { __preview3d?: { biome: string | null } }).__preview3d?.biome ?? null);
    await expect.poll(built, { timeout: 30_000 }).toBe('foundry');
    // A change of world rebuilds the scene.
    await page.getByTestId('world').selectOption('elven');
    await expect.poll(built, { timeout: 30_000 }).toBe('elven');
    // Closing frees the renderer (its canvas leaves the page).
    await page.keyboard.press('Escape');
    await page.locator('.grid').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('p');
    await expect(page.getByTestId('preview-canvas')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('builds a closed loop from the keyboard', async ({ page }) => {
    await page.goto('/mapeditor/');
    await page.evaluate(() => localStorage.removeItem('steamRacers.editor.doc'));
    await page.reload();
    await expect(page.getByTestId('report')).toContainText('not closed');
    await page.getByTestId('grid').click({ position: { x: 5, y: 5 } });
    for (const [key, n] of [['7', 2], ['2', 3], ['7', 2]] as const) {
      await page.keyboard.press(key);
      for (let i = 0; i < n; i++) await page.keyboard.press('Enter');
    }
    await expect(page.getByTestId('report')).toContainText('The track is raceable');
    await expect(page.getByTestId('play')).toBeEnabled();
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('play')).toBeDisabled();
  });
});
