/**
 * Line of sight across the track (gameplay.md §6.3, §7.2): barricades never break and stop shells.
 * The edge is a rule, not geometry (race/barricades.ts), so sight is a rule too: a shot line is
 * blocked where it leaves the track corridor (centre line ± half width + margin), e.g. across the
 * inside of a curve. Pure and cheap: a walk along the segment with a windowed nearest-sample search.
 */
import { tunables } from '../core/tunables';
import type { CompiledTrack } from '../track/compile';

tunables.registerGroup('weapons', [
  { key: 'weapons.sightStep', type: 'number', default: 2, min: 0.5, max: 8, step: 0.25, unit: 'm', label: 'Line of sight: check step' },
  { key: 'weapons.sightMargin', type: 'number', default: 0.6, min: -2, max: 4, step: 0.1, unit: 'm', label: 'Line of sight: corridor margin beyond the edge' },
]);

/** Samples searched on each side of the previous nearest one. */
const WINDOW = 25;

/**
 * Fraction (0..1) of the segment A→B where it first leaves the corridor, or null when clear.
 * @param hint index of the track sample nearest to A (e.g. the shooter's progress index)
 */
export function blockedAt(track: CompiledTrack, ax: number, az: number, bx: number, bz: number, hint: number): number | null {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 1e-3) return null;
  const step = tunables.get<number>('weapons.sightStep');
  const limit = track.halfWidth + tunables.get<number>('weapons.sightMargin');
  const n = track.samples.length;
  const count = Math.ceil(len / step);
  let idx = hint;
  for (let k = 1; k <= count; k++) {
    const f = Math.min(1, k / count);
    const x = ax + (bx - ax) * f;
    const z = az + (bz - az) * f;
    let best = -1;
    let bestD = Infinity;
    for (let o = -WINDOW; o <= WINDOW; o++) {
      const i = (((idx + o) % n) + n) % n;
      const p = track.samples[i]!;
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    // Far from every nearby centre-line sample: certainly beyond the edge.
    if (bestD > (limit * 2) ** 2) return f;
    const s = track.samples[best]!;
    const lateral = (x - s.x) * -s.tz + (z - s.z) * s.tx;
    if (Math.abs(lateral) > limit) return f;
    idx = best;
  }
  return null;
}
