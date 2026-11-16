/**
 * Tileset view (doc 05 §9, phase E4): renders the module tiles of the track, shows them and prints
 * them (browser print → PDF) with 3 mm bleed and cut marks, one module per A4 or two per A3, after
 * a layout sheet. The renderer (`tileset-render.ts`) is loaded on first use.
 */
import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { previewOpen, previewSeed } from './Preview';
import { doc, validation } from './store';
import { moduleTiles, type SquareMode } from './tileset';
import type { TilesetResult } from './tileset-render';

export const tilesetOpen = signal(false);
const squareMode = signal<SquareMode>('grid');
const paper = signal<'a4' | 'a3'>('a4');

/** `?tilepx=256`: small renders for quick checks of the sheets (print size stays 16 cm). */
const TEST_PX = Number(new URLSearchParams(location.search).get('tilepx')) || undefined;

const MODULE_MM = 160;
const BLEED_MM = 3;
const SIDE = MODULE_MM + 2 * BLEED_MM;

/** Cut marks around one printed module (mm, drawn outside the bleed). */
function CutMarks() {
  const o = 10; // margin around the image in the SVG
  const t0 = o + BLEED_MM;
  const t1 = o + BLEED_MM + MODULE_MM;
  const end = SIDE + 2 * o;
  const lines: [number, number, number, number][] = [];
  for (const t of [t0, t1]) {
    lines.push([t, 0, t, o - 1], [t, end - o + 1, t, end]); // vertical marks above / below
    lines.push([0, t, o - 1, t], [end - o + 1, t, end, t]); // horizontal marks left / right
  }
  return (
    <svg class="cutmarks" viewBox={`0 0 ${end} ${end}`} style={{ width: `${end}mm`, height: `${end}mm`, left: `-${o}mm`, top: `-${o}mm` }}>
      {lines.map(([a, b, c, d], i) => (
        <line key={i} x1={a} y1={b} x2={c} y2={d} stroke="#000" stroke-width="0.2" />
      ))}
    </svg>
  );
}

function Module({ url, label }: { url: string; label: string }) {
  return (
    <div class="module" style={{ width: `${SIDE}mm`, height: `${SIDE}mm` }}>
      <img src={url} alt={label} />
      <CutMarks />
    </div>
  );
}

export function TilesetView() {
  const [result, setResult] = useState<TilesetResult | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef(false);
  const v = validation.value;
  const modules = v.compiled ? moduleTiles(v.compiled, v.chain.steps.map((s) => s.level)) : [];

  // The 3D preview shares the ink uniforms: close it while the tiles are rendered.
  useEffect(() => {
    previewOpen.value = false;
    return () => {
      cancel.current = true;
    };
  }, []);
  useEffect(() => () => result?.dispose(), [result]);

  // Paper size for the print dialog.
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `@page { size: ${paper.value === 'a4' ? 'A4 portrait' : 'A3 landscape'}; margin: 0; }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [paper.value]);

  const render = async () => {
    if (!v.compiled || progress) return;
    cancel.current = false;
    setError(null);
    setProgress({ done: 0, total: modules.length + 1 });
    try {
      const { renderTileset } = await import('./tileset-render');
      const r = await renderTileset(v.compiled, modules, { squares: squareMode.value, seed: previewSeed.value, px: TEST_PX }, (done, total) => setProgress({ done, total }), () => cancel.current);
      setResult(r);
    } catch (e) {
      if ((e as Error).message !== 'cancelled') {
        console.error(e);
        setError((e as Error).message);
      }
    } finally {
      setProgress(null);
    }
  };

  const perSheet = paper.value === 'a4' ? 1 : 2;
  const sheets: TilesetResult['tiles'][] = [];
  if (result) for (let i = 0; i < result.tiles.length; i += perSheet) sheets.push(result.tiles.slice(i, i + perSheet));
  const sheetClass = `sheet ${paper.value}`;

  return (
    <div class="tileset" data-testid="tileset">
      <div class="tileset-bar">
        <strong>Tileset · {doc.value.meta.name}</strong>
        <span class="muted">{v.compiled ? `${modules.length} modules of 16 × 16 cm` : 'The track does not compile'}</span>
        <span class="sep" />
        <span class="muted">Squares on curves</span>
        <button class={squareMode.value === 'grid' ? 'on' : ''} onClick={() => (squareMode.value = 'grid')} title="The module's 8 × 8 grid everywhere (current board rules)">
          Grid
        </button>
        <button class={squareMode.value === 'lanes' ? 'on' : ''} onClick={() => (squareMode.value = 'lanes')} title="Curves: 6 concentric lanes split into spaces about one square long">
          Lanes
        </button>
        <span class="sep" />
        <button class={paper.value === 'a4' ? 'on' : ''} onClick={() => (paper.value = 'a4')} title="One module per A4 page">
          A4 × 1
        </button>
        <button class={paper.value === 'a3' ? 'on' : ''} onClick={() => (paper.value = 'a3')} title="Two modules per A3 page (landscape)">
          A3 × 2
        </button>
        <span class="sep" />
        {progress ? (
          <>
            <span data-testid="tileset-progress">
              Rendering {progress.done} / {progress.total}…
            </span>
            <button onClick={() => (cancel.current = true)}>Stop</button>
          </>
        ) : (
          <button class="play" disabled={!v.compiled} onClick={() => void render()} data-testid="tileset-render">
            {result ? 'Render again' : 'Render tiles'}
          </button>
        )}
        <button disabled={!result || !!progress} onClick={() => window.print()} data-testid="tileset-print" title="Print to PDF at 100 % scale (no fit to page)">
          Print…
        </button>
        <span class="grow" />
        <button onClick={() => (tilesetOpen.value = false)} title="Back to the editor">
          ✕
        </button>
      </div>
      {error && <p class="bad">Rendering failed: {error}</p>}
      <div class="tileset-body">
        {!result && !progress && (
          <p class="muted">
            Renders every module from above at 300 dpi with the world's look, the squares ({squareMode.value === 'grid' ? 'Grid' : 'Lanes'}), edge types, travel arrows,
            hazard letters, numbers and levels. Print at 100 % (no "fit to page"): the cut marks frame 16 × 16 cm; the 3 mm bleed goes beyond them. The dressing uses
            the 3D preview seed ({previewSeed.value}).
          </p>
        )}
        {result && (
          <div class="thumbs" data-testid="tileset-thumbs">
            <figure class="layout">
              <img src={result.layout} alt="Layout" />
              <figcaption>Layout sheet</figcaption>
            </figure>
            {result.tiles.map((t) => (
              <figure key={t.tile.label}>
                <a href={t.url} target="_blank" rel="noreferrer">
                  <img src={t.url} alt={t.tile.label} />
                </a>
                <figcaption>{t.tile.label}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
      {result && (
        <div class="sheets">
          <section class={`${sheetClass} layout-sheet`}>
            <img src={result.layout} alt="Layout" />
          </section>
          {sheets.map((s, i) => (
            <section key={i} class={sheetClass}>
              {s.map((t) => (
                <div class="slot" key={t.tile.label}>
                  <Module url={t.url} label={t.tile.label} />
                  <span class="caption">
                    {doc.value.meta.name} · {t.tile.label}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
