/**
 * Android phone over ADB, shared by the phone tools (run.ts, perf.ts).
 *
 * Needs Android platform-tools (`adb`; the copy bundled with scrcpy works) and the phone paired
 * over Wi-Fi (Developer options → Wireless debugging → Pair device with pairing code, then
 * `adb pair IP:PAIR_PORT CODE`) or plugged in with USB debugging. `adb -s DEVICE tcpip 5555`
 * once connected gives a fixed port until the phone reboots.
 *
 * Plain adb, no Playwright `_android.launchBrowser()`: on a non-rooted phone Chrome ignores the
 * debugging flags it writes and the launch hangs on about:blank. Chrome's own DevTools socket
 * (`chrome_devtools_remote`, always there with ADB debugging on) is forwarded and attached with CDP.
 * `adb reverse` maps the phone's localhost to the PC's server: a secure context, so WebGPU works
 * without HTTPS.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';

const argv = process.argv.slice(2);
export const arg = (k: string, d: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : d;
};

export const outDir = fileURLToPath(new URL('./out/', import.meta.url));
mkdirSync(outDir, { recursive: true });

export interface Phone {
  model: string;
  serial: string;
  browser: Browser;
  page: Page;
  errors: string[];
  logs: string[];
  close(): Promise<void>;
}

export type Hook = {
  __steamRacers: {
    tunables: { set(k: string, v: unknown): void; get(k: string): unknown };
    snapshot(): Record<string, unknown> & { players: Record<string, unknown>[] };
    game: Record<string, unknown>;
  };
};

/**
 * Connect, map the dev/preview server port and open a fresh tab.
 * Flags: --adb path, --serial IP[:PORT] (IP only → port from mDNS), --cdp-port 9333.
 */
export async function connectPhone(port: number): Promise<Phone> {
  const adbPath = arg('adb', process.env.ADB ?? 'adb');
  const adb = (...a: string[]) => execFileSync(adbPath, a, { encoding: 'utf8' }).trim();
  adb('start-server');
  const serialArg = arg('serial', '');
  let serial = serialArg;
  if (serial && !serial.includes(':')) {
    // Wireless debugging changes its connect port whenever it restarts (screen off, toggle).
    const line = adb('mdns', 'services')
      .split(/\r?\n/)
      .find((l) => l.includes('_adb-tls-connect') && l.includes(`${serial}:`));
    const m = line && /(\d+\.\d+\.\d+\.\d+:\d+)/.exec(line);
    if (!m) throw new Error(`No wireless-debugging service for ${serial}: is Wireless debugging on and the phone awake?`);
    serial = m[1]!;
  }
  if (serial.includes(':')) console.error(adb('connect', serial));
  const list = adb('devices')
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.split('\t'))
    .filter((c) => c[1] === 'device')
    .map((c) => c[0]!);
  const target = list.find((d) => !serial || d === serial) ?? list.find((d) => serialArg && d.includes(serialArg));
  if (!target) throw new Error('No Android device: check `adb devices` (pairing / USB debugging).');
  const sh = (cmd: string) => adb('-s', target, 'shell', cmd);
  const model = sh('getprop ro.product.model');
  console.error(`[phone] ${model} (${target})`);
  adb('-s', target, 'reverse', `tcp:${port}`, `tcp:${port}`);
  const cdpPort = Number(arg('cdp-port', '9333'));
  adb('-s', target, 'forward', `tcp:${cdpPort}`, 'localabstract:chrome_devtools_remote');
  // Wake the screen (no root needed) and bring Chrome to the front.
  sh('input keyevent KEYCODE_WAKEUP');
  sh('am start -n com.android.chrome/com.google.android.apps.chrome.Main -d about:blank');
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, { timeout: 30_000 });
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = await context.newPage();
  // tsx (esbuild keepNames) wraps functions passed to page.evaluate with `__name`.
  await page.addInitScript('window.__name = (f) => f');
  const errors: string[] = [];
  const logs: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.text().startsWith('[render]') || m.text().startsWith('[perf]')) logs.push(m.text());
  });
  return {
    model,
    serial: target,
    browser,
    page,
    errors,
    logs,
    async close() {
      // Leave the user's Chrome running: close only our tab, then disconnect.
      await page.close().catch(() => {});
      await browser.close().catch(() => {});
      adb('-s', target, 'forward', '--remove', `tcp:${cdpPort}`);
    },
  };
}

/** Open the game and wait until the race is ready (dev server: first load is slow over Wi-Fi). */
export async function openGame(phone: Phone, port: number, query: string): Promise<number> {
  const t0 = Date.now();
  await phone.page.goto(`http://localhost:${port}/?test&${query}`, { waitUntil: 'commit', timeout: 60_000 });
  console.error('[phone] page loading…');
  await phone.page.waitForFunction(() => '__steamRacers' in window && !document.querySelector('[data-testid=loading]'), null, { timeout: 240_000 });
  const s = (Date.now() - t0) / 1000;
  console.error(`[phone] ready in ${s.toFixed(1)} s`);
  return s;
}
