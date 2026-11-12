import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke + controls tests on desktop and mobile (doc 03 §16).
 * Headless Chromium usually has no WebGPU, so these runs exercise the WebGL2 fallback;
 * real WebGPU is checked manually on devices (see docs/testing-checklist.md).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5199',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
    // Mobile: Chromium with phone viewport, touch and mobile UA (landscape, as the game requires).
    { name: 'mobile', use: { ...devices['Pixel 7 landscape'] } },
  ],
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
