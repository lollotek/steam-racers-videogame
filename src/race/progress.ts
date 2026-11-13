/**
 * Track progress & laps (doc 03 §7.2). Pure: works on positions only.
 * Progress is the unwrapped distance travelled along the centre line from the start line,
 * so driving backwards reduces it (no lap cheese) and positions sort by it.
 */
import type { CompiledTrack } from '../track/compile';

export interface RacerProgress {
  /** Index of the nearest centre-line sample. */
  index: number;
  /** Distance along the lap of that sample (0..length). */
  s: number;
  /** Unwrapped distance since the start line (negative on the grid). */
  distance: number;
  lap: number; // laps completed
  lateral: number; // signed offset from the centre line (+ = right)
  wrongWayTime: number;
  offTrack: boolean;
  lapStart: number;
  lastLap: number | null;
  bestLap: number | null;
  lapTimes: number[];
  finishedAt: number | null;
}

export function createProgress(track: CompiledTrack, x: number, z: number): RacerProgress {
  const index = nearestSample(track, x, z, -1);
  const s = track.samples[index]!.s;
  let distance = s - track.lineS;
  if (distance > track.length / 2) distance -= track.length;
  return {
    index,
    s,
    distance,
    lap: 0,
    lateral: 0,
    wrongWayTime: 0,
    offTrack: false,
    lapStart: 0,
    lastLap: null,
    bestLap: null,
    lapTimes: [],
    finishedAt: null,
  };
}

/** Nearest sample; searches a window around `hint` first, falls back to a full scan. */
export function nearestSample(track: CompiledTrack, x: number, z: number, hint: number): number {
  const n = track.samples.length;
  const scan = (from: number, count: number) => {
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < count; k++) {
      const i = (((from + k) % n) + n) % n;
      const p = track.samples[i]!;
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return { best, bestD };
  };
  if (hint >= 0) {
    const w = scan(hint - 25, 51);
    if (w.bestD < (track.halfWidth * 2.5) ** 2) return w.best;
  }
  return scan(0, n).best;
}

export interface ProgressEvents {
  lapCompleted: boolean;
  finished: boolean;
}

/**
 * Update a racer's progress after a simulation step.
 * @param time race clock (s) used for lap times
 * @param speedAlong velocity component along the track tangent (for wrong-way detection)
 */
export function updateProgress(
  track: CompiledTrack,
  p: RacerProgress,
  x: number,
  z: number,
  speedAlong: number,
  time: number,
  dt: number,
  laps: number,
  running: boolean,
): ProgressEvents {
  const ev: ProgressEvents = { lapCompleted: false, finished: false };
  const index = nearestSample(track, x, z, p.index);
  const sample = track.samples[index]!;
  let ds = sample.s - p.s;
  if (ds < -track.length / 2) ds += track.length;
  if (ds > track.length / 2) ds -= track.length;
  p.index = index;
  p.s = sample.s;
  p.distance += ds;
  // Lateral offset: driver's right of tangent t is (-tz, tx).
  p.lateral = (x - sample.x) * -sample.tz + (z - sample.z) * sample.tx;
  p.offTrack = Math.abs(p.lateral) > track.halfWidth;
  p.wrongWayTime = speedAlong < -2 ? p.wrongWayTime + dt : 0;

  if (!running || p.finishedAt !== null) return ev;
  const lapsDone = Math.max(0, Math.floor(p.distance / track.length));
  if (lapsDone > p.lap) {
    p.lap = lapsDone;
    const lapTime = time - p.lapStart;
    p.lapStart = time;
    p.lastLap = lapTime;
    p.lapTimes.push(lapTime);
    if (p.bestLap === null || lapTime < p.bestLap) p.bestLap = lapTime;
    ev.lapCompleted = true;
    if (p.lap >= laps) {
      p.finishedAt = time;
      ev.finished = true;
    }
  }
  return ev;
}

/** Race order: finished racers by finish time, then by distance. Returns racer indices. */
export function standings(progress: RacerProgress[]): number[] {
  return progress
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      if (a.p.finishedAt !== null && b.p.finishedAt !== null) return a.p.finishedAt - b.p.finishedAt;
      if (a.p.finishedAt !== null) return -1;
      if (b.p.finishedAt !== null) return 1;
      return b.p.distance - a.p.distance;
    })
    .map((e) => e.i);
}
