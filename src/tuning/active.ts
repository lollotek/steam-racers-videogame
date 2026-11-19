/**
 * The playtest tuning in use: loaded from storage at boot, changed from the title screen.
 * Kept out of the debug panel so playtesters on the normal build can use it.
 */
import { signal } from '@preact/signals';
import { tunables } from '../core/tunables';
import { applyTuning, loadStoredTuning, storeTuning, type TuningFile } from '../core/tuning-file';

export const activeTuning = signal<TuningFile | null>(null);

let store: Storage | null = null;

/** Boot: apply the stored tuning (if any) before the first race is built. */
export function initTuning(s: Storage | null): void {
  store = s;
  const f = loadStoredTuning(s);
  if (f) applyTuning(tunables, f);
  activeTuning.value = f;
}

/** Replace the active tuning (null = back to the defaults) and remember it across reloads. */
export function setTuning(f: TuningFile | null): void {
  applyTuning(tunables, f);
  storeTuning(store, f);
  activeTuning.value = f;
}

export function tuningSummary(f: TuningFile): string {
  const n = Object.keys(f.params).length;
  return `${f.name} · ${n} parameter${n === 1 ? '' : 's'}`;
}
