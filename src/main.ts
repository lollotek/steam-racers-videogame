import { render, h } from 'preact';
import { parseFlags } from './core/flags';
import { createRenderer } from './render/renderer';
import { detectTier, isMobileDevice } from './render/quality';
import { TouchSource } from './input/touch';
import { Game } from './game/game';
import { App } from './ui/App';
import { ui } from './ui/state';
import { tunables } from './core/tunables';
import { initPhysics } from './sim/race-sim';
import { installAutoFullscreen } from './ui/fullscreen';
import { registerSW } from 'virtual:pwa-register';

async function boot(): Promise<void> {
  // autoUpdate: a new deploy's service worker takes over and the page reloads once, so players never run stale cached code.
  if (import.meta.env.PROD) registerSW({ immediate: true });
  const flags = parseFlags(location.search);
  const isMobile = isMobileDevice(navigator, window);
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  ui.showTouch.value = flags.touch ?? (isMobile || coarse);
  // Compact HUD layout for phones / touch screens (styles.css `body.touch-ui`).
  document.body.classList.toggle('touch-ui', ui.showTouch.value);
  // Phones: the first tap goes fullscreen and locks landscape (?fullscreen=0 to disable).
  if ((isMobile || coarse) && flags.fullscreen) installAutoFullscreen();

  const touch = new TouchSource();
  const uiRoot = document.getElementById('ui')!;
  let game: Game | null = null;
  render(h(App, { touch, onResume: () => game?.setPaused(false), onRestart: () => game?.startRace() }), uiRoot);

  await initPhysics();
  const gfx = await createRenderer(document.getElementById('viewport')!, flags.forceWebGL);
  ui.backend.value = gfx.backend;

  const nav = navigator as Navigator & { deviceMemory?: number };
  const tier =
    flags.tier ??
    detectTier({
      backend: gfx.backend,
      isMobile,
      cores: nav.hardwareConcurrency ?? 4,
      memoryGb: nav.deviceMemory ?? null,
      screenPixels: screen.width * screen.height * (devicePixelRatio || 1) ** 2,
    });

  game = new Game(gfx, { flags, isMobile, tier, touch });
  await game.warmUp();
  ui.loading.value = false;
  game.start();

  if (import.meta.env.DEV || flags.test) {
    (window as unknown as { __steamRacers: unknown }).__steamRacers = { game, tunables, snapshot: () => game!.snapshot() };
  }

  if (flags.debug) {
    const { mountDebugPanel } = await import('./debug/debug-panel');
    await mountDebugPanel(game, ui.showTouch.value);
  }
}

boot().catch((e: unknown) => {
  console.error(e);
  ui.loading.value = false;
  ui.error.value = e instanceof Error ? e.message : String(e);
});
