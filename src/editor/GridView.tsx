/**
 * The editor grid (doc 05 §6): SVG top view, pan / zoom, place / select / move tiles.
 * Drawing units are cells; screen x = −X, screen y = −Z (see geometry.ts).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Piece } from '../track/track-format';
import { type Socket, type Tile, canPlace, footprint } from './layout';
import { BARRICADE_COLOR, HAZARD_LETTER, SURFACE_COLOR, asArray, centreline, jumpGap, pathD, pointAt } from './geometry';
import { EDGE_SQUARES, LANE_REACH, MODULE_SQUARES, ROAD_SQUARES } from '../track/units';
import { doc, fitRequest, ghostAt, moveTile, placeAt, selected, tool, validation } from './store';

interface View {
  cx: number;
  cy: number;
  /** Pixels per cell. */
  scale: number;
}

const cellOf = (X: number, Z: number) => ({ x: Math.floor(X), z: Math.floor(Z) });

function TileShape({ t, cell, width, surface, left, right, level, state, squares }: {
  t: Socket & { piece: Piece };
  cell: number;
  width: number;
  surface: string;
  left: string;
  right: string;
  level: number | null;
  state: 'normal' | 'selected' | 'error' | 'unconnected' | 'ghost-ok' | 'ghost-bad';
  /** Draw the column lines (zoomed in). */
  squares: boolean;
}) {
  const p = t.piece;
  const pts = centreline(t);
  const hw = width / 2 / cell;
  const eb = EDGE_SQUARES / MODULE_SQUARES;
  const ghost = state.startsWith('ghost');
  const cells = footprint(t, p);
  const gap = p.type === 'jump' ? jumpGap(p, cell) : null;
  const mid = pointAt(pts, 0.5);
  const ang = (Math.atan2(-mid.tz, -mid.tx) * 180) / Math.PI;
  const road = SURFACE_COLOR[surface as keyof typeof SURFACE_COLOR] ?? '#888';
  return (
    <g class={`tile ${state}`} opacity={state === 'unconnected' ? 0.45 : ghost ? 0.7 : 1}>
      {cells.map((c) => (
        <rect key={`${c.x},${c.z}`} class="foot" x={-(c.x + 1)} y={-(c.z + 1)} width={1} height={1} />
      ))}
      {gap ? (
        <>
          <path d={pathD(pts, 0, 0, gap[0])} stroke={road} stroke-width={hw * 2} fill="none" />
          <path d={pathD(pts, 0, gap[0], gap[1])} class="pit" stroke-width={hw * 2} fill="none" />
          <path d={pathD(pts, 0, gap[1], 1)} stroke={road} stroke-width={hw * 2} fill="none" />
        </>
      ) : (
        <path d={pathD(pts)} stroke={road} stroke-width={hw * 2} fill="none" />
      )}
      {p.type === 'start' && <path d={pathD(pts, 0, 0.9, 0.93)} stroke="#f2ead8" stroke-width={hw * 2} fill="none" />}
      {/* Edge bands: one square wide outside the road, coloured by barricade (the printed tiles show the same). */}
      {[-1, 1].map((side) => {
        const col = BARRICADE_COLOR[(side < 0 ? left : right) as keyof typeof BARRICADE_COLOR] ?? '#999';
        const off = side * (hw + eb / 2);
        return gap ? (
          <g key={side}>
            <path d={pathD(pts, off, 0, gap[0])} stroke={col} stroke-width={eb} class="edge" fill="none" />
            <path d={pathD(pts, off, gap[1], 1)} stroke={col} stroke-width={eb} class="edge" fill="none" />
          </g>
        ) : (
          <path key={side} d={pathD(pts, off)} stroke={col} stroke-width={eb} class="edge" fill="none" />
        );
      })}
      {squares &&
        Array.from({ length: ROAD_SQUARES - 1 }, (_, k) => (
          <path key={`c${k}`} class="column" d={pathD(pts, -hw + ((k + 1) * 2 * hw) / ROAD_SQUARES)} fill="none" />
        ))}
      {(p.pickups ?? []).map((s, i) => {
        const q = pointAt(pts, s.at ?? 0.5, (s.lane ?? 0) * hw * LANE_REACH);
        return <circle key={`p${i}`} class={`pickup ${s.kind}`} cx={-q.x} cy={-q.z} r={0.07} />;
      })}
      {asArray(p.hazard).map((h, i) => {
        const q = pointAt(pts, h.at ?? 0.5);
        return (
          <g key={`h${i}`} transform={`translate(${-q.x} ${-q.z})`}>
            <rect class="hazard" x={-0.11} y={-0.11} width={0.22} height={0.22} transform="rotate(45)" />
            <text class="hazard-letter" y={0.05}>{HAZARD_LETTER[h.kind] ?? '?'}</text>
          </g>
        );
      })}
      {asArray(p.landmark).map((l, i) => {
        const side = l.side === 'R' ? 1 : -1;
        const q = pointAt(pts, l.at ?? 0.5, side * (hw + (l.offset ?? 20) / cell));
        return <circle key={`l${i}`} class="landmark" cx={-q.x} cy={-q.z} r={(l.radius ?? 15) / cell} />;
      })}
      <path class="arrow" d="M-0.12 -0.1 L0.1 0 L-0.12 0.1" transform={`translate(${-mid.x} ${-mid.z}) rotate(${ang})`} />
      {level !== null && (level !== 0 || p.rise) ? (
        <text class="level" x={-mid.x} y={-mid.z + 0.32}>
          {`L${level}${p.rise ? (p.rise > 0 ? ` ↑${p.rise}` : ` ↓${-p.rise}`) : ''}`}
        </text>
      ) : null}
    </g>
  );
}

export function GridView() {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ cx: -2, cy: -4, scale: 48 });
  const [hover, setHover] = useState<{ x: number; z: number } | null>(null);
  const drag = useRef<{ kind: 'pan' | 'move'; x0: number; y0: number; v0: View; tile?: Tile; cell0?: { x: number; z: number }; moved: boolean } | null>(null);
  const [moving, setMoving] = useState<{ tile: Tile; dx: number; dz: number } | null>(null);

  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Frame the whole track (on load and on request).
  const fit = () => {
    const tiles = doc.value.tiles;
    if (!tiles.length) return;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const t of tiles)
      for (const c of footprint(t, t.piece)) {
        x0 = Math.min(x0, c.x);
        x1 = Math.max(x1, c.x + 1);
        z0 = Math.min(z0, c.z);
        z1 = Math.max(z1, c.z + 1);
      }
    const el = ref.current;
    const w = el?.clientWidth || size.w;
    const h = el?.clientHeight || size.h;
    const scale = Math.max(12, Math.min(96, Math.min(w / (x1 - x0 + 3), h / (z1 - z0 + 3))));
    setView({ cx: -(x0 + x1) / 2, cy: -(z0 + z1) / 2, scale });
  };
  const fitTick = fitRequest.value;
  useEffect(() => {
    requestAnimationFrame(fit);
  }, [fitTick]);

  const toWorld = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    const sx = view.cx + (e.clientX - r.left - r.width / 2) / view.scale;
    const sy = view.cy + (e.clientY - r.top - r.height / 2) / view.scale;
    return { X: -sx, Z: -sy };
  };

  const d = doc.value;
  const v = validation.value;
  const occupied = new Map<string, Tile>();
  for (const t of d.tiles) for (const c of footprint(t, t.piece)) occupied.set(`${c.x},${c.z}`, t);

  const onDown = (e: PointerEvent) => {
    // Keyboard shortcuts go to the grid again (a focused inspector field swallows them).
    (document.activeElement as HTMLElement | null)?.blur?.();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const { X, Z } = toWorld(e);
    const c = cellOf(X, Z);
    if (e.button === 0 && tool.value) {
      placeAt(c.x, c.z);
      return;
    }
    const t = e.button === 0 ? occupied.get(`${c.x},${c.z}`) : undefined;
    if (t) {
      selected.value = t.id;
      drag.current = { kind: 'move', x0: e.clientX, y0: e.clientY, v0: view, tile: t, cell0: c, moved: false };
    } else {
      if (e.button === 0) selected.value = null;
      drag.current = { kind: 'pan', x0: e.clientX, y0: e.clientY, v0: view, moved: false };
    }
  };

  const onMove = (e: PointerEvent) => {
    const { X, Z } = toWorld(e);
    const c = cellOf(X, Z);
    if (!hover || hover.x !== c.x || hover.z !== c.z) setHover(c);
    const g = drag.current;
    if (!g) return;
    if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 4) g.moved = true;
    if (g.kind === 'pan') setView({ ...g.v0, cx: g.v0.cx - (e.clientX - g.x0) / g.v0.scale, cy: g.v0.cy - (e.clientY - g.y0) / g.v0.scale });
    else if (g.moved && g.tile && g.cell0) setMoving({ tile: g.tile, dx: c.x - g.cell0.x, dz: c.z - g.cell0.z });
  };

  const onUp = () => {
    const g = drag.current;
    drag.current = null;
    if (g?.kind === 'move' && moving && (moving.dx || moving.dz)) moveTile(moving.tile.id, moving.tile.x + moving.dx, moving.tile.z + moving.dz);
    setMoving(null);
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = ref.current!.getBoundingClientRect();
    const mx = e.clientX - r.left - r.width / 2;
    const my = e.clientY - r.top - r.height / 2;
    const k = Math.exp(-e.deltaY * 0.0015);
    const scale = Math.max(8, Math.min(160, view.scale * k));
    // Keep the point under the cursor fixed.
    const wx = view.cx + mx / view.scale;
    const wy = view.cy + my / view.scale;
    setView({ cx: wx - mx / scale, cy: wy - my / scale, scale });
  };

  useEffect(() => {
    const el = ref.current!;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const vb = `${view.cx - size.w / 2 / view.scale} ${view.cy - size.h / 2 / view.scale} ${size.w / view.scale} ${size.h / view.scale}`;
  const errorTiles = new Set(v.errors.map((e) => e.tileId).filter((x): x is number => x !== undefined));
  const unconnected = new Set(v.chain.unconnected);
  const levels = new Map(v.chain.steps.map((s) => [s.tileId, s.level]));
  const m = d.meta;
  const shape = (t: Socket & { piece: Piece }, state: Parameters<typeof TileShape>[0]['state'], key: string | number, level: number | null) => (
    <TileShape
      key={key}
      t={t}
      cell={m.cell}
      width={m.width}
      surface={t.piece.surface ?? m.defaultSurface}
      left={t.piece.left ?? m.defaultBarricade}
      right={t.piece.right ?? m.defaultBarricade}
      level={level}
      state={state}
      squares={view.scale >= 64}
    />
  );
  const ghost = tool.value && hover ? ghostAt(hover.x, hover.z) : null;
  const end = v.chain.openEnd;
  const movedTile = moving ? { ...moving.tile, x: moving.tile.x + moving.dx, z: moving.tile.z + moving.dz } : null;
  const order = new Map(v.chain.steps.map((s, i) => [s.tileId, i + 1]));

  return (
    <svg
      ref={ref}
      class={`grid ${tool.value ? 'placing' : ''}`}
      viewBox={vb}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={() => setHover(null)}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="grid"
    >
      <defs>
        <pattern id="cells" width={1} height={1} patternUnits="userSpaceOnUse">
          <path d="M1 0 L0 0 L0 1" class="gridline" />
        </pattern>
        <pattern id="squares" width={1 / MODULE_SQUARES} height={1 / MODULE_SQUARES} patternUnits="userSpaceOnUse">
          <path d={`M${1 / MODULE_SQUARES} 0 L0 0 L0 ${1 / MODULE_SQUARES}`} class="gridline square" />
        </pattern>
        <pattern id="cells5" width={5} height={5} patternUnits="userSpaceOnUse">
          <path d="M5 0 L0 0 L0 5" class="gridline major" />
        </pattern>
      </defs>
      <rect x={view.cx - size.w / view.scale} y={view.cy - size.h / view.scale} width={(size.w * 2) / view.scale} height={(size.h * 2) / view.scale} fill="url(#cells)" />
      <rect x={view.cx - size.w / view.scale} y={view.cy - size.h / view.scale} width={(size.w * 2) / view.scale} height={(size.h * 2) / view.scale} fill="url(#cells5)" />
      <circle class="origin" cx={0} cy={0} r={0.06} />
      {d.tiles.map((t) =>
        shape(
          t,
          movedTile?.id === t.id ? 'unconnected' : selected.value === t.id ? 'selected' : errorTiles.has(t.id) ? 'error' : unconnected.has(t.id) ? 'unconnected' : 'normal',
          t.id,
          levels.get(t.id) ?? null,
        ),
      )}
      {/* Squares (one vehicle each, 2 cm printed) over the road when zoomed in. */}
      {view.scale >= 64 && <rect class="squares" x={view.cx - size.w / view.scale} y={view.cy - size.h / view.scale} width={(size.w * 2) / view.scale} height={(size.h * 2) / view.scale} fill="url(#squares)" />}
      {d.tiles.map((t) => {
        const n = order.get(t.id);
        if (!n || view.scale < 22) return null;
        const c = footprint(t, t.piece)[0]!;
        return (
          <text key={`n${t.id}`} class="order" x={-(c.x + 1) + 0.06} y={-(c.z + 1) + 0.2}>
            {n}
          </text>
        );
      })}
      {movedTile && shape(movedTile, canPlace(d.tiles, movedTile, movedTile.id) ? 'ghost-ok' : 'ghost-bad', 'move', null)}
      {end && (
        <g class="open-end" transform={`translate(${-(end.x + 0.5)} ${-(end.z + 0.5)}) rotate(${(Math.atan2(-[1, 0, -1, 0][end.dir]!, -[0, 1, 0, -1][end.dir]!) * 180) / Math.PI})`}>
          <rect x={-0.5} y={-0.5} width={1} height={1} />
          <path d="M-0.25 -0.2 L0.2 0 L-0.25 0.2 Z" />
        </g>
      )}
      {ghost && shape(ghost, ghost.ok ? 'ghost-ok' : 'ghost-bad', 'ghost', null)}
      {hover && !tool.value && <rect class="hover" x={-(hover.x + 1)} y={-(hover.z + 1)} width={1} height={1} />}
    </svg>
  );
}
