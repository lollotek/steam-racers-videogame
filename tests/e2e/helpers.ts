import { expect, type Page } from '@playwright/test';

export interface Snapshot {
  backend: string;
  tier: string;
  frames: number;
  simSteps: number;
  paused: boolean;
  particles: number;
  players: { gear: number; pushCooldown: number; speed: number; heading: number; device: string; input: string }[];
}

export async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => (window as unknown as { __steamRacers: { snapshot(): Snapshot } }).__steamRacers.snapshot());
}

/** Load the game, collect console errors, wait until frames are rendering. */
export async function boot(page: Page, query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`/?test${query ? `&${query}` : ''}`);
  await expect.poll(() => page.evaluate(() => '__steamRacers' in window), { timeout: 90_000 }).toBe(true);
  await expect.poll(async () => (await snapshot(page)).frames, { timeout: 90_000 }).toBeGreaterThan(30);
  return errors;
}

export const isMobileProject = (name: string) => name === 'mobile';
