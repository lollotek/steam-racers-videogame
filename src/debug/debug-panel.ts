/**
 * Tuning panel (doc 03 §15.1). Loaded only with ?debug (dynamic import → zero cost otherwise).
 * Built automatically from the Tunables registry; presets in localStorage, JSON export/import.
 */
import { Pane, type FolderApi } from 'tweakpane';
import Stats from 'stats-gl';
import { type Preset, type TunableDef, tunables } from '../core/tunables';
import type { Game } from '../game/game';

const PRESETS_KEY = 'sr.tuningPresets';

function loadPresets(): Record<string, Preset> {
  try {
    return JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '{}') as Record<string, Preset>;
  } catch {
    return {};
  }
}

function savePresets(p: Record<string, Preset>): void {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable (private mode) */
  }
}

export async function mountDebugPanel(game: Game, isTouch: boolean): Promise<void> {
  const container = document.createElement('div');
  container.id = 'debug-panel';
  document.body.appendChild(container);

  const pane = new Pane({ title: 'Steam Racers · debug', container, expanded: !isTouch });

  // --- Monitor ---------------------------------------------------------------
  const mon = { backend: '', tier: '', scale: 0, frameMs: 0, simSteps: 0, p1: '', p2: '' };
  const mf = pane.addFolder({ title: 'Monitor', expanded: true });
  mf.addBinding(mon, 'backend', { readonly: true });
  mf.addBinding(mon, 'tier', { readonly: true });
  mf.addBinding(mon, 'scale', { readonly: true, format: (v: number) => `${Math.round(v * 100)}%` });
  mf.addBinding(mon, 'frameMs', { readonly: true, label: 'avg ms', format: (v: number) => v.toFixed(1) });
  mf.addBinding(mon, 'simSteps', { readonly: true, label: 'sim steps', format: (v: number) => v.toFixed(0) });
  mf.addBinding(mon, 'p1', { readonly: true, label: 'P1 input' });
  if (game.slots.length > 1) mf.addBinding(mon, 'p2', { readonly: true, label: 'P2 input' });
  setInterval(() => {
    const s = game.snapshot();
    mon.backend = s.backend;
    mon.tier = s.tier;
    mon.scale = s.renderScale;
    mon.frameMs = game.dynres.averageMs;
    mon.simSteps = s.simSteps;
    mon.p1 = s.players[0]?.input ?? '';
    mon.p2 = s.players[1]?.input ?? '';
  }, 100);

  // --- Presets -----------------------------------------------------------------
  const pf = pane.addFolder({ title: 'Presets', expanded: false });
  const state = { name: 'my-preset', load: '' };
  pf.addBinding(state, 'name', { label: 'name' });
  pf.addButton({ title: 'Save preset' }).on('click', () => {
    const all = loadPresets();
    all[state.name] = tunables.toPreset();
    savePresets(all);
    rebuildLoad();
  });
  let loadBlade: ReturnType<FolderApi['addBinding']> | null = null;
  const rebuildLoad = () => {
    loadBlade?.dispose();
    const names = Object.keys(loadPresets());
    state.load = names[0] ?? '';
    loadBlade = pf.addBinding(state, 'load', {
      label: 'load',
      options: Object.fromEntries(names.map((n) => [n, n])),
      index: 1,
    });
  };
  rebuildLoad();
  pf.addButton({ title: 'Load selected' }).on('click', () => {
    const p = loadPresets()[state.load];
    if (p) {
      tunables.applyPreset(p);
      pane.refresh();
    }
  });
  pf.addButton({ title: 'Reset all to defaults' }).on('click', () => {
    tunables.reset();
    pane.refresh();
  });
  pf.addButton({ title: 'Export JSON (clipboard)' }).on('click', async () => {
    const json = JSON.stringify(tunables.toPreset(), null, 2);
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      window.prompt('Copy the tuning JSON:', json);
    }
  });
  pf.addButton({ title: 'Import JSON' }).on('click', () => {
    const txt = window.prompt('Paste tuning JSON:');
    if (!txt) return;
    try {
      tunables.applyPreset(JSON.parse(txt) as Preset);
      pane.refresh();
    } catch (e) {
      window.alert(`Invalid JSON: ${(e as Error).message}`);
    }
  });

  // --- Tunables, grouped -------------------------------------------------------
  for (const group of tunables.groups()) {
    const folder = pane.addFolder({ title: group, expanded: false });
    const proxy: Record<string, unknown> = {};
    for (const t of tunables.all().filter((t) => t.def.group === group)) {
      const def = t.def;
      Object.defineProperty(proxy, def.key, {
        get: () => tunables.get(def.key),
        set: (v) => tunables.set(def.key, v as never),
        enumerable: true,
      });
      folder.addBinding(proxy, def.key, bindingParams(def));
    }
    folder.addButton({ title: `Reset ${group}` }).on('click', () => {
      for (const t of tunables.all().filter((t) => t.def.group === group)) tunables.reset(t.def.key);
      pane.refresh();
    });
  }

  // --- Stats ------------------------------------------------------------------
  try {
    const stats = new Stats({ trackGPU: false, horizontal: true, minimal: isTouch });
    await stats.init(game.gfx.renderer);
    const holder = document.createElement('div');
    holder.id = 'debug-stats';
    stats.dom.style.position = 'static'; // stats-gl defaults to fixed top-left (over the HUD)
    holder.appendChild(stats.dom);
    document.body.appendChild(holder);
    const tick = () => {
      stats.update();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } catch (e) {
    console.warn('[debug] stats-gl unavailable', e);
  }
}

function bindingParams(def: TunableDef): Record<string, unknown> {
  const label = def.label ?? def.key.split('.').pop();
  switch (def.type) {
    case 'number':
      return { label: def.unit ? `${label} (${def.unit})` : label, min: def.min, max: def.max, step: def.step };
    case 'option':
      return { label, options: Object.fromEntries(def.options.map((o) => [o, o])) };
    default:
      return { label };
  }
}
