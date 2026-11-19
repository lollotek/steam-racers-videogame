import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileTrack } from '../../src/track/compile';
import { classifyCorners } from '../../src/track/corners';
import type { TrackFile } from '../../src/track/track-format';
import { DEFAULT_TIMINGS, type Vec3, pickKeyPoints, planIntro, trackAt } from '../../src/race/intro-shots';

const DIR = join(__dirname, '../../src/tracks');
const TRACKS = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => [f, JSON.parse(readFileSync(join(DIR, f), 'utf8')) as TrackFile] as const);

function setup(file: TrackFile) {
  const track = compileTrack(file);
  const corners = classifyCorners(track, { sGap: 20 });
  const racers = track.spawn.slice(0, 6).map((p) => ({ x: p.x, y: p.y, z: p.z, heading: p.heading }));
  return { track, corners, racers };
}

const finite = (v: Vec3) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const circ = (a: number, b: number, L: number) => {
  const d = (((a - b) % L) + L) % L;
  return Math.min(d, L - d);
};

describe('race intro shots', () => {
  it.each(TRACKS)('%s: overview, key points in lap order, grid, hero', (_name, file) => {
    const { track, corners, racers } = setup(file);
    const shots = planIntro({ track, corners, racers, hero: 0, heroSlot: 2, heroName: 'Player 1' });
    const kinds = shots.map((s) => s.kind);
    expect(kinds[0]).toBe('establish');
    expect(kinds.slice(-2)).toEqual(['grid', 'hero']);
    const points = kinds.filter((k) => k === 'point').length;
    expect(points).toBeGreaterThanOrEqual(1);
    expect(points).toBeLessThanOrEqual(DEFAULT_TIMINGS.points);
    expect(shots[0]!.title).toBe(file.name.toUpperCase());
    expect(shots.at(-1)!.sub).toBe('STARTS P3');

    // Every pose is finite, the camera never sits on its target and stays above the road.
    const e = { x: 0, y: 0, z: 0 };
    const l = { x: 0, y: 0, z: 0 };
    for (const s of shots) {
      for (const u of [0, 0.25, 0.5, 0.75, 1]) {
        s.eye(u, e);
        s.look(u, l);
        expect(finite(e) && finite(l)).toBe(true);
        expect(Math.hypot(e.x - l.x, e.y - l.y, e.z - l.z)).toBeGreaterThan(3);
        expect(e.y).toBeGreaterThan(l.y);
        expect(s.fov(u)).toBeGreaterThan(10);
      }
    }
  });

  it('key points: spread round the lap, sorted from the start line', () => {
    for (const [, file] of TRACKS) {
      const { track, corners } = setup(file);
      const pts = pickKeyPoints(track, corners, 4);
      const ahead = pts.map((p) => (((p.s - track.lineS) % track.length) + track.length) % track.length);
      expect(ahead).toEqual([...ahead].sort((a, b) => a - b));
      for (let i = 0; i < pts.length; i++)
        for (let j = i + 1; j < pts.length; j++) expect(circ(pts[i]!.s, pts[j]!.s, track.length)).toBeGreaterThanOrEqual(track.length / 6 - 1e-6);
    }
  });

  it('jumps and hazards come before plain bends', () => {
    const withJump = TRACKS.map(([, f]) => setup(f)).find((t) => t.track.jumps.length > 0);
    if (!withJump) return;
    const pts = pickKeyPoints(withJump.track, withJump.corners, 1);
    expect(pts[0]!.title).toMatch(/JUMP|VENTS|CROSSING|CRANE|STREAM/);
  });

  it('trackAt wraps the lap and returns a unit tangent', () => {
    const { track } = setup(TRACKS[0]![1]);
    const a = trackAt(track, 10);
    const b = trackAt(track, 10 + track.length);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.z).toBeCloseTo(a.z, 6);
    expect(Math.hypot(a.tx, a.tz)).toBeCloseTo(1, 6);
  });

  it('zero-length shots are dropped (tunables set to 0)', () => {
    const { track, corners, racers } = setup(TRACKS[0]![1]);
    const shots = planIntro({ track, corners, racers, hero: 0, heroSlot: 0, heroName: 'P', timings: { establish: 0, points: 0 } });
    expect(shots.map((s) => s.kind)).toEqual(['grid', 'hero']);
  });
});
