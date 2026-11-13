/**
 * Track registry for the game (the headless tools read the JSON files directly).
 * `?track=<id>` picks one; unknown ids fall back to the foundry.
 */
import type { TrackFile } from '../track/track-format';
import foundry from './foundry-01.json';
import provingGround from './proving-ground.json';

export const TRACKS: Record<string, TrackFile> = {
  'foundry-01': foundry as TrackFile,
  'proving-ground': provingGround as TrackFile,
};

export const DEFAULT_TRACK = 'foundry-01';

export function getTrack(id: string | null): TrackFile {
  const t = id ? TRACKS[id] : undefined;
  if (id && !t) console.warn(`[track] unknown track "${id}", using ${DEFAULT_TRACK}`);
  return t ?? TRACKS[DEFAULT_TRACK]!;
}
