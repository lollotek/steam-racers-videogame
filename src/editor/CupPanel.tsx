/**
 * Cup configuration (doc 05 §10, phase E5): which tracks make up the Cup and in which order, with
 * the texts the briefing shows. Edits `src/cup/cups.json` (saved to the project in dev builds,
 * downloaded otherwise).
 */
import { signal } from '@preact/signals';
import { useMemo, useState } from 'preact/hooks';
import { CUP_CONFIG, type CupConfig, type CupRound } from '../cup/cup';
import { compileTrack } from '../track/compile';
import { checkTrack } from '../track/rules';
import { TRACKS } from '../tracks';
import { formatCupsJson } from './format';
import { WORLD_LABEL } from './Inspector';
import { CAN_SAVE_TO_PROJECT, saveCupsToProject } from './project';
import { doc, notify } from './store';

export const cupOpen = signal(false);

/** World name for a track: the one the Cup already uses for that biome, else the editor label. */
function worldFor(cup: CupConfig, trackId: string): string {
  const biome = TRACKS[trackId]?.biome ?? '';
  const used = cup.rounds.find((r) => TRACKS[r.trackId]?.biome === biome);
  return used?.world ?? WORLD_LABEL[biome] ?? biome;
}

/** Cup rule warnings of a track (doc 04 §4), cached per id. */
function useWarnings(): (id: string) => string[] {
  return useMemo(() => {
    const cache = new Map<string, string[]>();
    return (id: string) => {
      if (!cache.has(id)) {
        const t = TRACKS[id];
        let out: string[] = [];
        try {
          out = t ? checkTrack(compileTrack(t)).problems : ['unknown track'];
        } catch (e) {
          out = [(e as Error).message];
        }
        cache.set(id, out);
      }
      return cache.get(id)!;
    };
  }, []);
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CupPanel() {
  const [cup, setCup] = useState<CupConfig>(() => structuredClone(CUP_CONFIG));
  const [busy, setBusy] = useState(false);
  const warnings = useWarnings();
  const dirty = JSON.stringify(cup) !== JSON.stringify(CUP_CONFIG);
  const ids = Object.keys(TRACKS);

  const setRound = (i: number, patch: Partial<CupRound>) => setCup({ ...cup, rounds: cup.rounds.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= cup.rounds.length) return;
    const rounds = cup.rounds.slice();
    [rounds[i], rounds[j]] = [rounds[j]!, rounds[i]!];
    setCup({ ...cup, rounds });
  };
  const add = () => {
    const id = TRACKS[doc.value.meta.id] ? doc.value.meta.id : ids[0]!;
    setCup({ ...cup, rounds: [...cup.rounds, { trackId: id, track: TRACKS[id]!.name, world: worldFor(cup, id), hazard: '', blurb: '' }] });
  };
  const save = async () => {
    // Track names follow the track files (the briefing shows them).
    const out: CupConfig = { name: cup.name.trim() || 'Cup', rounds: cup.rounds.map((r) => ({ ...r, track: TRACKS[r.trackId]?.name ?? r.track })) };
    if (!CAN_SAVE_TO_PROJECT) {
      download('cups.json', formatCupsJson(out));
      return notify('Downloaded cups.json: put it in src/cup/');
    }
    setBusy(true);
    if (await saveCupsToProject(out)) cupOpen.value = false;
    setBusy(false);
  };

  return (
    <div class="modal" data-testid="cup-panel" onClick={(e) => e.target === e.currentTarget && (cupOpen.value = false)}>
      <section class="dialog">
        <header>
          <h2>Cup</h2>
          <input value={cup.name} onInput={(e) => setCup({ ...cup, name: (e.currentTarget as HTMLInputElement).value })} aria-label="Cup name" />
          <span class="grow" />
          <button onClick={() => (cupOpen.value = false)} title="Close (changes not saved)">
            ✕
          </button>
        </header>
        <p class="muted">
          The races of the Cup, in order. The briefing shows the world, the hazard and the description; the track name comes from the track file. The game's menus show one
          Cup.
        </p>
        <ol class="rounds">
          {cup.rounds.map((r, i) => {
            const w = warnings(r.trackId);
            return (
              <li key={i} data-testid="cup-round">
                <div class="round-head">
                  <select
                    value={r.trackId}
                    onChange={(e) => {
                      const id = (e.currentTarget as HTMLSelectElement).value;
                      setRound(i, { trackId: id, track: TRACKS[id]?.name ?? id, world: worldFor(cup, id) });
                    }}
                  >
                    {!TRACKS[r.trackId] && <option value={r.trackId}>{r.trackId} (missing)</option>}
                    {ids.map((id) => (
                      <option key={id} value={id}>
                        {TRACKS[id]!.name} · {id}
                      </option>
                    ))}
                  </select>
                  <input value={r.world} placeholder="World" onInput={(e) => setRound(i, { world: (e.currentTarget as HTMLInputElement).value })} />
                  <button onClick={() => move(i, -1)} disabled={i === 0} title="Earlier">
                    ↑
                  </button>
                  <button onClick={() => move(i, 1)} disabled={i === cup.rounds.length - 1} title="Later">
                    ↓
                  </button>
                  <button onClick={() => setCup({ ...cup, rounds: cup.rounds.filter((_, k) => k !== i) })} disabled={cup.rounds.length === 1} title="Remove">
                    ✕
                  </button>
                </div>
                <input value={r.hazard} placeholder="Hazard (briefing)" onInput={(e) => setRound(i, { hazard: (e.currentTarget as HTMLInputElement).value })} />
                <textarea rows={2} value={r.blurb} placeholder="Description (briefing)" onInput={(e) => setRound(i, { blurb: (e.currentTarget as HTMLTextAreaElement).value })} />
                {w.length > 0 && <p class="warn">Cup rules: {w.join(' · ')}</p>}
              </li>
            );
          })}
        </ol>
        <footer>
          <button onClick={add}>+ Add race</button>
          <span class="grow" />
          <button onClick={() => setCup(structuredClone(CUP_CONFIG))} disabled={!dirty}>
            Revert
          </button>
          <button class="primary" onClick={() => void save()} disabled={busy || !dirty} data-testid="cup-save">
            {CAN_SAVE_TO_PROJECT ? 'Save to project' : 'Download cups.json'}
          </button>
        </footer>
      </section>
    </div>
  );
}
