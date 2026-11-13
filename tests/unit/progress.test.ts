import { describe, expect, it } from 'vitest';
import { compileTrack } from '../../src/track/compile';
import { createProgress, standings, updateProgress } from '../../src/race/progress';
import type { TrackFile } from '../../src/track/track-format';
import foundry from '../../src/tracks/foundry-01.json';

const track = compileTrack(foundry as TrackFile);
const n = track.samples.length;

describe('progress & laps', () => {
  it('starts behind the line with negative distance', () => {
    const sp = track.spawn[0]!;
    const p = createProgress(track, sp.x, sp.z);
    expect(p.distance).toBeLessThan(0);
    expect(p.distance).toBeGreaterThan(-20);
  });

  it('counts laps when crossing the line forward and finishes after N laps', () => {
    const sp = track.spawn[0]!;
    const p = createProgress(track, sp.x, sp.z);
    const start = p.index;
    let time = 0;
    const events: string[] = [];
    for (let k = 1; k <= n * 3 + 20; k++) {
      const smp = track.samples[(start + k) % n]!;
      time += 0.05;
      const ev = updateProgress(track, p, smp.x, smp.z, 20, time, 0.05, 3, true);
      if (ev.lapCompleted) events.push('lap');
      if (ev.finished) events.push('finish');
    }
    expect(events.filter((e) => e === 'lap')).toHaveLength(3);
    expect(events).toContain('finish');
    expect(p.lapTimes).toHaveLength(3);
    expect(p.bestLap).not.toBeNull();
  });

  it('driving backwards does not count laps and flags wrong way', () => {
    const sp = track.spawn[0]!;
    const p = createProgress(track, sp.x, sp.z);
    let time = 0;
    for (let k = 0; k < n * 2; k++) {
      const smp = track.samples[(((p.index - 1) % n) + n) % n]!;
      time += 0.05;
      updateProgress(track, p, smp.x, smp.z, -20, time, 0.05, 3, true);
    }
    expect(p.lap).toBe(0);
    expect(p.distance).toBeLessThan(-track.length);
    expect(p.wrongWayTime).toBeGreaterThan(1);
  });

  it('lateral offset is + on the driver right', () => {
    const smp = track.samples[10]!;
    const p = createProgress(track, smp.x, smp.z);
    // Driver's right of tangent (tx, tz) is (-tz, tx).
    updateProgress(track, p, smp.x - smp.tz * 3, smp.z + smp.tx * 3, 0, 0, 0.016, 3, false);
    expect(p.lateral).toBeCloseTo(3, 1);
  });

  it('standings: finished first by time, then by distance', () => {
    const mk = (distance: number, finishedAt: number | null) => ({ ...createProgress(track, 0, 0), distance, finishedAt });
    expect(standings([mk(100, null), mk(50, 30), mk(200, null), mk(60, 25)])).toEqual([3, 1, 2, 0]);
  });
});
