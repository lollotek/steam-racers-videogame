import { expect, type Page } from '@playwright/test';

export interface Snapshot {
  backend: string;
  tier: string;
  frames: number;
  simSteps: number;
  paused: boolean;
  particles: number;
  phase: 'countdown' | 'running' | 'finished';
  clock: number;
  players: { gear: number; pushCooldown: number; pv: number; pf: number; ammo: number; wrecked: boolean; start: string | null; boilerTest: string | null; lap: number; distance: number; speed: number; heading: number; device: string; input: string }[];
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
  // Gears are frozen during the countdown (doc 03 §14): wait for GO.
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 90_000 }).toBe('running');
  // M3: no pushes during the calm time after GO (plus a possible start stall, gameplay.md §4).
  await expect.poll(async () => (await snapshot(page)).clock, { timeout: 90_000 }).toBeGreaterThan(4.2);
  return errors;
}

export const isMobileProject = (name: string) => name === 'mobile';
