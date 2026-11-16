/**
 * Track registry for the game (the headless tools read the JSON files directly).
 * `?track=<id>` picks one; unknown ids fall back to the foundry.
 */
import type { TrackFile } from '../track/track-format';

/**
 * Every JSON file in this folder is a track, keyed by its file name (doc 05 §10: the editor's
 * "Save to project" just adds a file). The default track first, then by name.
 */
const FILES = import.meta.glob<TrackFile>('./*.json', { eager: true, import: 'default' });
const ID = (path: string) => path.replace(/^\.\//, '').replace(/\.json$/, '');

export const DEFAULT_TRACK = 'foundry-01';

export const TRACKS: Record<string, TrackFile> = Object.fromEntries(
  Object.entries(FILES)
    .map(([path, file]) => [ID(path), file] as const)
    .sort(([a, fa], [b, fb]) => (a === DEFAULT_TRACK ? -1 : b === DEFAULT_TRACK ? 1 : fa.name.localeCompare(fb.name))),
);

export function getTrack(id: string | null): TrackFile {
  const t = id ? TRACKS[id] : undefined;
  if (id && !t) console.warn(`[track] unknown track "${id}", using ${DEFAULT_TRACK}`);
  return t ?? TRACKS[DEFAULT_TRACK]!;
}
