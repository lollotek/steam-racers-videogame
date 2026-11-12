import { render, h } from 'preact';
import { parseFlags } from './core/flags';
import { createRenderer } from './render/renderer';
import { detectTier, isMobileDevice } from './render/quality';
import { TouchSource } from './input/touch';
import { Game } from './game/game';
import { App } from './ui/App';
import { ui } from './ui/state';

async function boot(): Promise<void> {
  const flags = parseFlags(location.search);
  const isMobile = isMobileDevice(navigator, window);
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  ui.showTouch.value = flags.touch ?? (isMobile || coarse);

  const touch = new TouchSource();
  const uiRoot = document.getElementById('ui')!;
  let game: Game | null = null;
  render(h(App, { touch, onResume: () => game?.setPaused(false) }), uiRoot);

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
  game.start();

  if (import.meta.env.DEV || flags.test) {
    (window as unknown as { __steamRacers: unknown }).__steamRacers = { game, snapshot: () => game!.snapshot() };
  }

  if (flags.debug) {
    const { mountDebugPanel } = await import('./debug/debug-panel');
    await mountDebugPanel(game, ui.showTouch.value);
  }
}

boot().catch((e: unknown) => {
  console.error(e);
  ui.error.value = e instanceof Error ? e.message : String(e);
});
