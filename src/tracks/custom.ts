/**
 * Hand-off of an editor track to the game (doc 05 §6): the editor stores it, `/?custom` races it.
 */
import type { TrackFile } from '../track/track-format';

export const CUSTOM_TRACK_KEY = 'steamRacers.customTrack';

interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function saveCustomTrack(store: KeyValueStore | null, file: TrackFile): boolean {
  if (!store) return false;
  try {
    store.setItem(CUSTOM_TRACK_KEY, JSON.stringify(file));
    return true;
  } catch {
    return false;
  }
}

export function loadCustomTrack(store: KeyValueStore | null): TrackFile | null {
  try {
    const raw = store?.getItem(CUSTOM_TRACK_KEY);
    if (!raw) return null;
    const f = JSON.parse(raw) as TrackFile;
    return Array.isArray(f.pieces) && f.pieces.length ? f : null;
  } catch {
    return null;
  }
}
