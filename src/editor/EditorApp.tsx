/**
 * Track editor page (doc 05 §6): top bar, palette, grid, inspector, status line, keyboard.
 */
import { useEffect, useRef } from 'preact/hooks';
import { TRACKS } from '../tracks';
import { saveCustomTrack } from '../tracks/custom';
import { docFromFile, newDoc, toTrackFile } from './layout';
import { GridView } from './GridView';
import { Inspector, WORLD_LABEL } from './Inspector';
import { PreviewPanel, previewOpen } from './Preview';
import { TilesetView, tilesetOpen } from './TilesetView';
import {
  PALETTE,
  appendAtEnd,
  canRedo,
  canUndo,
  deleteSelected,
  doc,
  fitRequest,
  flip,
  historyTick,
  message,
  notify,
  redo,
  replaceDoc,
  reverseSelected,
  rotate,
  selected,
  tool,
  toolTurn,
  undo,
  validation,
} from './store';

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function save(): void {
  const file = toTrackFile(doc.value);
  download(`${doc.value.meta.id}.json`, JSON.stringify(file, null, 2) + '\n');
  notify(`Saved ${doc.value.meta.id}.json`);
}

export function play(): void {
  const v = validation.value;
  if (!v.compiled) return notify(`Fix the track first: ${v.errors[0]?.message ?? 'it does not compile'}`, 'error');
  let store: Storage | null = null;
  try {
    store = window.localStorage;
  } catch {
    /* no storage */
  }
  if (!saveCustomTrack(store, toTrackFile(doc.value, v.chain, false))) return notify('Cannot hand the track to the game (browser storage is blocked)', 'error');
  window.open(`${import.meta.env.BASE_URL}?custom`, 'steam-racers-play');
  notify('Race opened in the game tab');
}

async function openFile(f: File): Promise<void> {
  try {
    replaceDoc(docFromFile(JSON.parse(await f.text())));
    notify(`Loaded ${f.name}`);
  } catch (e) {
    notify(`Cannot open ${f.name}: ${(e as Error).message}`, 'error');
  }
}

export function EditorApp() {
  const fileInput = useRef<HTMLInputElement>(null);
  void historyTick.value; // re-render undo / redo state

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select')) return;
      if (tilesetOpen.value) {
        if (e.key === 'Escape') tilesetOpen.value = false;
        return;
      }
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && k === 'y') {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && k === 's') {
        e.preventDefault();
        save();
      } else if (e.ctrlKey || e.metaKey || e.altKey) return;
      else if (k === 'r') rotate(e.shiftKey ? -1 : 1);
      else if (k === 'f') flip();
      else if (k === 'p') previewOpen.value = !previewOpen.value;
      else if (k === 'v') reverseSelected();
      else if (k === 'enter') appendAtEnd();
      else if (k === 'delete' || k === 'backspace') deleteSelected();
      else if (k === 'escape') {
        tool.value = null;
        selected.value = null;
      } else if (k === 'home') fitRequest.value++;
      else if (/^[1-9]$/.test(k)) {
        const item = PALETTE[Number(k) - 1];
        if (item) {
          tool.value = item.key;
          selected.value = null;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const v = validation.value;
  const msg = message.value;
  return (
    <div class="editor">
      <header class="topbar">
        <strong class="brand">Steam Racers · Track editor</strong>
        <button onClick={() => confirm('Start a new track? The current one is replaced (save it first).') && replaceDoc(newDoc())}>New</button>
        <button onClick={() => fileInput.current?.click()}>Open file…</button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          data-testid="open-file"
          onChange={(e) => {
            const f = (e.currentTarget as HTMLInputElement).files?.[0];
            if (f) void openFile(f);
            (e.currentTarget as HTMLInputElement).value = '';
          }}
        />
        <select
          data-testid="standard"
          value=""
          onChange={(e) => {
            const id = (e.currentTarget as HTMLSelectElement).value;
            const t = TRACKS[id];
            if (t) {
              replaceDoc(docFromFile(structuredClone(t)));
              notify(`Loaded the standard track ${t.name}`);
            }
          }}
        >
          <option value="">Standard track…</option>
          {Object.entries(TRACKS).map(([id, t]) => (
            <option key={id} value={id}>
              {t.name} ({WORLD_LABEL[t.biome] ?? t.biome})
            </option>
          ))}
        </select>
        <button onClick={save} title="Ctrl+S">Save JSON</button>
        <span class="sep" />
        <button onClick={undo} disabled={!canUndo()} title="Ctrl+Z">↶</button>
        <button onClick={redo} disabled={!canRedo()} title="Ctrl+Y">↷</button>
        <button onClick={() => fitRequest.value++} title="Home">Fit</button>
        <span class="sep" />
        <button class="play" onClick={play} disabled={!v.compiled} data-testid="play">▶ Play</button>
        <button class={previewOpen.value ? 'on' : ''} onClick={() => (previewOpen.value = !previewOpen.value)} title="P" data-testid="preview-toggle">
          3D preview
        </button>
        <button onClick={() => (tilesetOpen.value = true)} disabled={!v.compiled} data-testid="tileset-open" title="Printable module tiles">
          Show tileset
        </button>
      </header>

      <nav class="palette">
        <h2>Pieces</h2>
        <button class={tool.value === null ? 'on' : ''} onClick={() => (tool.value = null)} title="Esc">
          ⬚ Select / move
        </button>
        {PALETTE.map((p, i) => (
          <button
            key={p.key}
            class={tool.value === p.key ? 'on' : ''}
            onClick={() => {
              tool.value = p.key;
              selected.value = null;
            }}
            title={`Key ${i + 1}`}
          >
            <kbd>{i + 1}</kbd> {p.label}
            {p.piece.type === 'curve' && tool.value === p.key ? ` ${toolTurn.value}` : ''}
          </button>
        ))}
        <div class="help">
          <p>
            <kbd>R</kbd> rotate · <kbd>F</kbd> flip curve
          </p>
          <p>
            <kbd>Enter</kbd> add at the open end
          </p>
          <p>
            <kbd>V</kbd> reverse tile · <kbd>Del</kbd> delete
          </p>
          <p>
            <kbd>P</kbd> 3D preview
          </p>
          <p>Drag a tile to move it; drag the ground or right-drag to pan; wheel to zoom.</p>
        </div>
      </nav>

      <main class={`canvas ${previewOpen.value ? 'split' : ''}`}>
        <div class="grid-pane">
          <GridView />
          <div class={`status ${msg?.kind ?? ''}`}>
            {msg ? msg.text : v.compiled ? `${doc.value.meta.name} · ${Math.round(v.compiled.length)} m · ${doc.value.tiles.length} tiles` : `${doc.value.meta.name} · ${v.errors[0]?.message ?? ''}`}
          </div>
        </div>
        {previewOpen.value && <PreviewPanel />}
      </main>

      <Inspector />
      {tilesetOpen.value && <TilesetView />}
    </div>
  );
}
