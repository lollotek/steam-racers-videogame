/**
 * Right panel (doc 05 §6): the selected tile, or the track settings; always the validation report.
 */
import { useEffect, useState } from 'preact/hooks';
import {
  type Barricade,
  type HazardSpec,
  type LandmarkSlot,
  type Piece,
  type PickupSlot,
  type Surface,
  HAZARD_KINDS,
  MAX_CREST,
  PICKUP_KINDS,
  SURFACES,
  asArray,
} from '../track/track-format';
import { TRACKS } from '../tracks';
import { resolveHazard } from '../track/hazards';
import { ROAD_SQUARES, WIDTH, boundOfLine, columnOfLane, laneOfColumn, lineOfBound } from '../track/units';
import { slug } from './layout';
import { commit, doc, selected, updatePiece, validation } from './store';

const BARRICADES: Barricade[] = ['earth', 'riveted', 'hedgehog', 'corrugated', 'sandbags', 'barbed', 'stone', 'runepylon', 'ironrail', 'wreckwall', 'tyres', 'roots', 'crystal'];

export const WORLD_LABEL: Record<string, string> = {
  foundry: 'Foundry (wastelands)',
  dwarven: 'Dwarven hold',
  victorian: 'Victorian city',
  orc: 'Orc scrapyard',
  elven: 'Elven forest',
};
/** Worlds, and the zones / landmarks their standard tracks use (hints for the inspector). */
export const WORLDS = (() => {
  const out = new Map<string, { zones: Set<string>; landmarks: Set<string> }>();
  for (const id of Object.keys(WORLD_LABEL)) out.set(id, { zones: new Set(), landmarks: new Set() });
  for (const t of Object.values(TRACKS)) {
    const w = out.get(t.biome) ?? { zones: new Set<string>(), landmarks: new Set<string>() };
    out.set(t.biome, w);
    for (const p of t.pieces) {
      if (p.zone) w.zones.add(p.zone);
      for (const l of asArray(p.landmark)) w.landmarks.add(l.id);
    }
  }
  return out;
})();

const num = (v: string) => (v === '' ? undefined : Number(v));

const COLUMNS = Array.from({ length: ROAD_SQUARES }, (_, c) => c);
/** Column ranges [first line, last line] (line 0 = left edge … 6 = right edge). */
const SPANS: [number, number][] = COLUMNS.flatMap((a) => COLUMNS.filter((c) => c >= a).map((c): [number, number] => [a, c + 1]));
const spanKey = (l: [number, number]) => `${lineOfBound(l[0])}-${lineOfBound(l[1])}`;
const spanLanes = (k: string): [number, number] => {
  const [a, b] = k.split('-').map(Number);
  return [boundOfLine(a!), boundOfLine(b!)];
};

function Select<T extends string>({ value, options, onChange, def }: { value: T | undefined; options: readonly T[]; onChange: (v: T | undefined) => void; def?: string }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(((e.currentTarget as HTMLSelectElement).value || undefined) as T | undefined)}>
      {def !== undefined && <option value="">{def}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Row({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <label class="row">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Set or clear an optional field. */
function setField<K extends keyof Piece>(p: Piece, k: K, v: Piece[K] | undefined): Piece {
  const q = { ...p };
  if (v === undefined || (v as unknown) === '' || (typeof v === 'number' && (Number.isNaN(v) || v === 0) && k !== 'size')) delete q[k];
  else q[k] = v;
  return q;
}

function TileInspector({ id }: { id: number }) {
  const t = doc.value.tiles.find((o) => o.id === id);
  const [json, setJson] = useState('');
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  useEffect(() => {
    if (t) setJson(JSON.stringify(t.piece, null, 1));
    setJsonErr(null);
  }, [t?.piece]);
  if (!t) return null;
  const p = t.piece;
  const meta = doc.value.meta;
  const world = WORLDS.get(meta.biome);
  const set = <K extends keyof Piece>(k: K, v: Piece[K] | undefined) => updatePiece(id, (q) => setField(q, k, v));
  const step = validation.value.chain.steps.findIndex((s) => s.tileId === id);
  const sizes = p.type === 'curve' ? [1, 2, 3] : p.type === 'jump' ? [2, 3, 4, 5] : [1, 2, 3, 4, 5, 6, 7, 8];
  const pickups = p.pickups ?? [];
  const hazards = asArray(p.hazard);
  const landmarks = asArray(p.landmark);
  const setPickups = (l: PickupSlot[]) => set('pickups', l.length ? l : undefined);
  const setHazards = (l: HazardSpec[]) => set('hazard', l.length ? (l.length === 1 ? l[0] : l) : undefined);
  const setLandmarks = (l: LandmarkSlot[]) => set('landmark', l.length ? (l.length === 1 ? l[0] : l) : undefined);

  return (
    <section>
      <h2>
        {p.type} {step >= 0 ? <small>#{step + 1} in the race</small> : <small>not connected</small>}
      </h2>
      <Row label="Size">
        <select value={p.size ?? 1} onChange={(e) => set('size', Number((e.currentTarget as HTMLSelectElement).value))}>
          {sizes.map((s) => (
            <option key={s} value={s}>
              {s} {p.type === 'curve' ? `(r ${(s - 0.5) * meta.cell} m)` : `(${s * meta.cell} m)`}
            </option>
          ))}
        </select>
      </Row>
      {p.type === 'curve' && (
        <Row label="Turn">
          <Select value={p.turn} options={['L', 'R'] as const} onChange={(v) => set('turn', v ?? 'R')} />
        </Row>
      )}
      <Row label="Surface">
        <Select<Surface> value={p.surface} options={SURFACES} def={`default (${meta.defaultSurface})`} onChange={(v) => set('surface', v)} />
      </Row>
      <Row label="Left edge">
        <Select<Barricade> value={p.left} options={BARRICADES} def={`default (${meta.defaultBarricade})`} onChange={(v) => set('left', v)} />
      </Row>
      <Row label="Right edge">
        <Select<Barricade> value={p.right} options={BARRICADES} def={`default (${meta.defaultBarricade})`} onChange={(v) => set('right', v)} />
      </Row>
      {p.type !== 'start' && (
        <Row label={p.type === 'jump' ? 'Landing levels' : 'Rise (levels)'}>
          <input type="number" min={-3} max={3} step={1} value={p.rise ?? 0} onChange={(e) => set('rise', num((e.currentTarget as HTMLInputElement).value))} />
        </Row>
      )}
      {p.type === 'straight' && (
        <Row label="Crest (m)">
          <input type="number" min={-MAX_CREST} max={MAX_CREST} step={0.5} value={p.crest ?? 0} onChange={(e) => set('crest', num((e.currentTarget as HTMLInputElement).value))} />
        </Row>
      )}
      <Row label="Zone">
        <input list="zones" value={p.zone ?? ''} placeholder="none" onChange={(e) => set('zone', (e.currentTarget as HTMLInputElement).value.trim() || undefined)} />
        <datalist id="zones">{[...(world?.zones ?? [])].map((z) => <option key={z} value={z} />)}</datalist>
      </Row>

      <h3>
        Crates <button onClick={() => setPickups([...pickups, { kind: 'coal', at: 0.5, lane: laneOfColumn(3) }])}>+</button>
      </h3>
      {pickups.map((s, i) => (
        <div class="item" key={i}>
          <Select value={s.kind} options={PICKUP_KINDS} onChange={(v) => setPickups(pickups.map((o, k) => (k === i ? { ...o, kind: v ?? 'coal' } : o)))} />
          <input title="Along the piece 0..1" type="number" min={0} max={1} step={0.05} value={s.at ?? 0.5} onChange={(e) => setPickups(pickups.map((o, k) => (k === i ? { ...o, at: Number((e.currentTarget as HTMLInputElement).value) } : o)))} />
          <select title="Column, 1 = left … 6 = right (driver's view)" value={columnOfLane(s.lane ?? 0)} onChange={(e) => setPickups(pickups.map((o, k) => (k === i ? { ...o, lane: laneOfColumn(Number((e.currentTarget as HTMLSelectElement).value)) } : o)))}>
            {COLUMNS.map((c) => <option key={c} value={c}>col {c + 1}</option>)}
          </select>
          <button onClick={() => setPickups(pickups.filter((_, k) => k !== i))}>×</button>
        </div>
      ))}

      <h3>
        Hazards <button onClick={() => setHazards([...hazards, { kind: 'vent', at: 0.5 }])}>+</button>
      </h3>
      {hazards.map((h, i) => (
        <div class="item" key={i}>
          <Select value={h.kind} options={HAZARD_KINDS} onChange={(v) => setHazards(hazards.map((o, k) => (k === i ? { ...o, kind: v ?? 'vent' } : o)))} />
          <input title="Along the piece 0..1" type="number" min={0} max={1} step={0.05} value={h.at ?? 0.5} onChange={(e) => setHazards(hazards.map((o, k) => (k === i ? { ...o, at: Number((e.currentTarget as HTMLInputElement).value) } : o)))} />
          <select title="Columns covered (1 = left … 6 = right)" value={spanKey(resolveHazard(h).lanes)} onChange={(e) => setHazards(hazards.map((o, k) => (k === i ? { ...o, lanes: spanLanes((e.currentTarget as HTMLSelectElement).value) } : o)))}>
            {SPANS.map(([a, b]) => <option key={`${a}-${b}`} value={`${a}-${b}`}>{a === b - 1 ? `col ${b}` : `col ${a + 1}–${b}`}</option>)}
          </select>
          <button onClick={() => setHazards(hazards.filter((_, k) => k !== i))}>×</button>
        </div>
      ))}

      <h3>
        Landmark <button onClick={() => setLandmarks([...landmarks, { id: [...(world?.landmarks ?? [])][0] ?? 'landmark', side: 'L', at: 0.5 }])}>+</button>
      </h3>
      {landmarks.map((l, i) => (
        <div class="item" key={i}>
          <input list="landmarks" value={l.id} onChange={(e) => setLandmarks(landmarks.map((o, k) => (k === i ? { ...o, id: (e.currentTarget as HTMLInputElement).value } : o)))} />
          <Select value={l.side} options={['L', 'R'] as const} onChange={(v) => setLandmarks(landmarks.map((o, k) => (k === i ? { ...o, side: v ?? 'L' } : o)))} />
          <input title="Offset from the edge (m)" type="number" min={0} max={80} step={1} value={l.offset ?? 20} onChange={(e) => setLandmarks(landmarks.map((o, k) => (k === i ? { ...o, offset: Number((e.currentTarget as HTMLInputElement).value) } : o)))} />
          <button onClick={() => setLandmarks(landmarks.filter((_, k) => k !== i))}>×</button>
        </div>
      ))}
      <datalist id="landmarks">{[...(world?.landmarks ?? [])].map((z) => <option key={z} value={z} />)}</datalist>

      <details>
        <summary>Raw JSON (all parameters)</summary>
        <textarea
          rows={8}
          value={json}
          spellcheck={false}
          onInput={(e) => setJson((e.currentTarget as HTMLTextAreaElement).value)}
          onBlur={() => {
            try {
              const q = JSON.parse(json) as Piece;
              if (!q || typeof q.type !== 'string') throw new Error('"type" is missing');
              if (JSON.stringify(q) !== JSON.stringify(p)) updatePiece(id, () => q);
              setJsonErr(null);
            } catch (e) {
              setJsonErr((e as Error).message);
            }
          }}
        />
        {jsonErr && <p class="bad">{jsonErr}</p>}
      </details>
    </section>
  );
}

function TrackSettings() {
  const m = doc.value.meta;
  const set = (patch: Partial<typeof m>) => commit({ ...doc.value, meta: { ...m, ...patch } });
  return (
    <section>
      <h2>Track</h2>
      <Row label="Name">
        <input value={m.name} onChange={(e) => {
          const name = (e.currentTarget as HTMLInputElement).value;
          set({ name, id: slug(name) });
        }} />
      </Row>
      <Row label="Id (file)">
        <input value={m.id} onChange={(e) => set({ id: slug((e.currentTarget as HTMLInputElement).value) })} />
      </Row>
      <Row label="World">
        <select value={m.biome} onChange={(e) => set({ biome: (e.currentTarget as HTMLSelectElement).value })} data-testid="world">
          {[...WORLDS.keys()].map((b) => (
            <option key={b} value={b}>
              {WORLD_LABEL[b] ?? b}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Laps">
        <input type="number" min={1} max={9} value={m.laps} onChange={(e) => set({ laps: Math.max(1, Math.min(9, Number((e.currentTarget as HTMLInputElement).value) || 3)) })} />
      </Row>
      <Row label="Width (m)">
        <span class="fixed">
          {m.width} m{m.width === WIDTH ? ` (${ROAD_SQUARES} squares)` : ''}
          {m.width !== WIDTH && <button onClick={() => set({ width: WIDTH })}>Use {WIDTH} m</button>}
        </span>
      </Row>
      <Row label="Level height (m)">
        <input type="number" min={2} max={8} step={0.5} value={m.level ?? 4} onChange={(e) => set({ level: Number((e.currentTarget as HTMLInputElement).value) || 4 })} />
      </Row>
      <Row label="Default surface">
        <Select<Surface> value={m.defaultSurface} options={SURFACES} onChange={(v) => v && set({ defaultSurface: v })} />
      </Row>
      <Row label="Default edge">
        <Select<Barricade> value={m.defaultBarricade} options={BARRICADES} onChange={(v) => v && set({ defaultBarricade: v })} />
      </Row>
    </section>
  );
}

function Report() {
  const v = validation.value;
  const r = v.report;
  return (
    <section class="report" data-testid="report">
      <h2>Check</h2>
      {v.errors.length ? (
        <ul class="bad">
          {v.errors.map((e, i) => (
            <li key={i}>
              {e.tileId !== undefined ? (
                <a href="#" onClick={(ev) => {
                  ev.preventDefault();
                  selected.value = e.tileId!;
                }}>
                  {e.message}
                </a>
              ) : (
                e.message
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p class="good">✓ The track is raceable</p>
      )}
      {v.chain.unconnected.length > 0 && <p class="warn">{v.chain.unconnected.length} tile(s) not connected (ignored)</p>}
      {r && (
        <>
          <dl>
            <dt>Length</dt>
            <dd>{Math.round(r.length)} m</dd>
            <dt>Longest straight</dt>
            <dd>{Math.round(r.longestStraight)} m</dd>
            <dt>Hairpins / tight</dt>
            <dd>
              {r.hairpins} / {r.tightCorners}
            </dd>
            <dt>Jumps</dt>
            <dd>{r.jumps}</dd>
            <dt>Height range</dt>
            <dd>{r.heightRange.toFixed(1)} m</dd>
            <dt>Hazards / landmarks</dt>
            <dd>
              {r.hazards} / {r.landmarks}
            </dd>
          </dl>
          {r.problems.length ? (
            <ul class="warn">
              {r.problems.map((p, i) => (
                <li key={i}>Cup rule: {p}</li>
              ))}
            </ul>
          ) : (
            <p class="good">✓ Cup rules</p>
          )}
        </>
      )}
    </section>
  );
}

export function Inspector() {
  const id = selected.value;
  return (
    <aside class="inspector">
      {id !== null ? <TileInspector id={id} /> : <TrackSettings />}
      <Report />
    </aside>
  );
}
