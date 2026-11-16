/**
 * "Save to project" (doc 05 §10, dev builds only): the editor posts tracks and the Cup to the dev
 * server (`tools/vite/editor-save.ts`), which writes them into `src/tracks` and `src/cup`. The track
 * list and the Cup are modules, so the page then reloads to pick them up: the autosave is flushed
 * first and the confirmation survives the reload in session storage.
 */
import type { CupConfig } from '../cup/cup';
import { TRACKS } from '../tracks';
import { toTrackFile } from './layout';
import { doc, flushAutosave, notify, validation } from './store';

/** True on the dev server, where the save endpoint exists. */
export const CAN_SAVE_TO_PROJECT = import.meta.env.DEV;
const NOTICE_KEY = 'steamRacers.editor.notice';

async function post(body: object): Promise<{ ok: boolean; path?: string; created?: boolean; error?: string }> {
  const res = await fetch('/__editor/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    return await res.json();
  } catch {
    return { ok: false, error: `HTTP ${res.status}` };
  }
}

/** Show the confirmation, keep it across the reload, reload (new track list / Cup). */
function doneAndReload(text: string): void {
  notify(text);
  try {
    sessionStorage.setItem(NOTICE_KEY, text);
  } catch {
    /* no storage: the notice is just not shown again after the reload */
  }
  setTimeout(() => location.reload(), 600);
}

/** Show the confirmation of a save that reloaded the page. */
export function showPendingNotice(): void {
  try {
    const text = sessionStorage.getItem(NOTICE_KEY);
    if (text) notify(text);
    sessionStorage.removeItem(NOTICE_KEY);
  } catch {
    /* ignore */
  }
}

/** Save the current track as `src/tracks/<id>.json` (raceable tracks only, no editor layout). */
export async function saveTrackToProject(): Promise<void> {
  const v = validation.value;
  if (!v.compiled) return notify(`Fix the track first: ${v.errors[0]?.message ?? 'it does not compile'}`, 'error');
  const id = doc.value.meta.id;
  if (TRACKS[id] && !confirm(`src/tracks/${id}.json already exists (${TRACKS[id]!.name}). Overwrite it?`)) return;
  flushAutosave();
  try {
    const r = await post({ kind: 'track', file: toTrackFile(doc.value, v.chain, false) });
    if (!r.ok) return notify(`Not saved: ${r.error}`, 'error');
    doneAndReload(`${r.created ? 'Added' : 'Updated'} ${r.path}`);
  } catch (e) {
    notify(`Not saved: ${(e as Error).message}`, 'error');
  }
}

/** Save the Cup configuration as `src/cup/cups.json`. */
export async function saveCupsToProject(cups: CupConfig): Promise<boolean> {
  flushAutosave();
  try {
    const r = await post({ kind: 'cups', cups });
    if (!r.ok) {
      notify(`Cup not saved: ${r.error}`, 'error');
      return false;
    }
    doneAndReload(`Updated ${r.path}`);
    return true;
  } catch (e) {
    notify(`Cup not saved: ${(e as Error).message}`, 'error');
    return false;
  }
}
