import { render, h } from 'preact';
import { parseFlags } from './core/flags';
import { createRenderer } from './render/renderer';
import { detectTier, isMobileDevice } from './render/quality';
import { TouchSource } from './input/touch';
import type { Game } from './game/game';
import { Flow } from './flow/flow';
import { App } from './ui/App';
import { flowUi, ui, type FlowActions } from './ui/state';
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
  let flow: Flow | null = null;
  // Screens call the flow once it exists (it needs the renderer); until then they are inert.
  const actions = new Proxy({} as FlowActions, {
    get: (_t, k) => {
      if (k === 'tracks') return flow?.tracks ?? [];
      return (...args: unknown[]) => (flow as unknown as Record<string, (...a: unknown[]) => unknown> | null)?.[k as string]?.(...args);
    },
  });
  if (!flags.quick && !flags.custom) flowUi.screen.value = 'title';
  render(h(App, { touch, actions }), uiRoot);

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

  let game: Game | null = null;
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    /* private mode: the Cup is not saved */
  }
  flow = new Flow({ gfx, flags, isMobile, tier, touch, store: storage, onGame: (g) => (game = g) });

  if (import.meta.env.DEV || flags.test) {
    (window as unknown as { __steamRacers: unknown }).__steamRacers = {
      get game() {
        return game;
      },
      flow,
      tunables,
      snapshot: () => game?.snapshot() ?? null,
    };
  }

  if (flags.debug) {
    const { mountDebugPanel } = await import('./debug/debug-panel');
    await mountDebugPanel(() => game, gfx.renderer, ui.showTouch.value);
  }

  await flow.boot();
}

boot().catch((e: unknown) => {
  console.error(e);
  ui.loading.value = false;
  ui.error.value = e instanceof Error ? e.message : String(e);
});
