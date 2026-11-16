/**
 * 3D preview panel (doc 05 §8, phase E3): beside the grid, rebuilt (debounced) when the track
 * compiles after an edit. The renderer lives in `preview3d.ts`, loaded on first open.
 */
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Preview3D, ViewPreset } from './preview3d';
import { selected, validation } from './store';

export const previewOpen = signal(false);
/** Dressing seed of the preview (doc 03 §7.3: editable, reroll). The game picks its own per race. */
export const previewSeed = signal(1);
const showSquares = signal(false);
const animate = signal(true);

/** What a rebuild depends on: the compiled file without its name (renaming does not rebuild). */
function trackKey(): string | null {
  const c = validation.value.compiled;
  if (!c) return null;
  const { name: _n, ...rest } = c.file;
  return JSON.stringify(rest);
}

export function PreviewPanel() {
  const host = useRef<HTMLDivElement>(null);
  const preview = useRef<Preview3D | null>(null);
  const [state, setState] = useState<{ kind: 'loading' | 'ready' | 'error'; text?: string }>({ kind: 'loading' });
  const lastId = useRef<string | null>(null);

  // Create the renderer once per open panel.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { Preview3D } = await import('./preview3d');
        const p = await Preview3D.create(host.current!);
        if (!alive) return p.dispose();
        preview.current = p;
        if (import.meta.env.DEV) (window as unknown as { __preview3d: Preview3D }).__preview3d = p;
        p.setGrid(showSquares.value);
        p.animate = animate.value;
        setState({ kind: 'ready', text: p.backend });
      } catch (e) {
        console.error(e);
        if (alive) setState({ kind: 'error', text: (e as Error).message });
      }
    })();
    return () => {
      alive = false;
      preview.current?.dispose();
      preview.current = null;
    };
  }, []);

  // Rebuild when the compiled track, its world or the seed change (debounced: typing stays smooth).
  const key = trackKey();
  const seed = previewSeed.value;
  const ready = state.kind === 'ready';
  useEffect(() => {
    const p = preview.current;
    const compiled = validation.value.compiled;
    if (!ready || !p || !compiled) return;
    const timer = setTimeout(() => {
      try {
        // A different track (or the first build) frames the camera; edits keep it where it is.
        const frame = lastId.current !== compiled.file.id;
        lastId.current = compiled.file.id;
        p.setTrack(compiled, seed, frame);
      } catch (e) {
        console.error(e);
        setState({ kind: 'error', text: (e as Error).message });
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [key, seed, ready]);

  // Follow the selection: the camera centres on the selected tile's piece.
  const sel = selected.value;
  useEffect(() => {
    if (sel === null || !preview.current) return;
    const index = validation.value.chain.steps.findIndex((s) => s.tileId === sel);
    if (index >= 0) preview.current.focusPiece(index);
  }, [sel]);

  const view = (v: ViewPreset) => preview.current?.view(v);
  return (
    <section class="preview" data-testid="preview">
      <div class="preview-host" ref={host} />
      <div class="preview-bar">
        <button onClick={() => view('orbit')} title="Whole track, 3/4 view">Orbit</button>
        <button onClick={() => view('board')} title="The race camera angles (camera.board.*)">Board</button>
        <button onClick={() => view('top')} title="Straight from above">Top</button>
        <span class="sep" />
        <button
          class={showSquares.value ? 'on' : ''}
          onClick={() => {
            showSquares.value = !showSquares.value;
            preview.current?.setGrid(showSquares.value);
          }}
          title="Tabletop squares on the road (as ?grid in the game)"
        >
          Squares
        </button>
        <button
          class={animate.value ? 'on' : ''}
          onClick={() => {
            animate.value = !animate.value;
            if (preview.current) preview.current.animate = animate.value;
          }}
          title="Hazards cycle as in a race"
        >
          Hazards ▶
        </button>
        <span class="sep" />
        <label title="Dressing seed (the props around the track)">
          Seed{' '}
          <input
            type="number"
            min={1}
            value={seed}
            data-testid="preview-seed"
            onChange={(e) => (previewSeed.value = Math.max(1, Math.floor(Number((e.currentTarget as HTMLInputElement).value) || 1)))}
          />
        </label>
        <button onClick={() => (previewSeed.value = 1 + Math.floor(Math.random() * 99999))} title="New dressing">
          🎲
        </button>
        <span class="grow" />
        <button onClick={() => (previewOpen.value = false)} title="Close the 3D preview (P)">
          ✕
        </button>
      </div>
      <div class={`preview-note ${state.kind}`} data-testid="preview-state">
        {state.kind === 'loading'
          ? 'Starting the renderer…'
          : state.kind === 'error'
            ? `3D preview failed: ${state.text}`
            : validation.value.compiled
              ? `${state.text} · drag to orbit, right-drag to pan, wheel to zoom`
              : 'Waiting for a track that compiles'}
      </div>
    </section>
  );
}
