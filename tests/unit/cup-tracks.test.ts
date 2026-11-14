import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RaceSim, initPhysics } from '../../src/sim/race-sim';
import { createDriver, driveRacer } from '../../src/ai/driver';
import { HOT_ROD, STEAM_TANK } from '../../src/vehicles/vehicle-physics';
import { compileTrack } from '../../src/track/compile';
import { checkTrack } from '../../src/track/rules';
import { CUP_ROUNDS } from '../../src/cup/cup';
import type { TrackFile } from '../../src/track/track-format';

/** Doc 04 phase C: the four Cup worlds, one track each, in Cup order. */
const load = (id: string) => JSON.parse(readFileSync(new URL(`../../src/tracks/${id}.json`, import.meta.url), 'utf8')) as TrackFile;
const WORLDS: Record<string, string> = { 'runegate-deep': 'dwarven', 'cinderholme-station': 'victorian', 'rustmaw-pit': 'orc', 'lirael-canopy': 'elven' };

beforeAll(async () => {
  await initPhysics();
});

describe('Cup tracks (doc 04 §4, §7)', () => {
  it('the Cup runs on the four world tracks, in order', () => {
    expect(CUP_ROUNDS.map((r) => r.trackId)).toEqual(Object.keys(WORLDS));
  });

  for (const [id, biome] of Object.entries(WORLDS)) {
    it(`${id}: compiles, uses the ${biome} biome and follows the shared track rules`, () => {
      const file = load(id);
      expect(file.biome).toBe(biome);
      const report = checkTrack(compileTrack(file));
      expect(report.problems).toEqual([]);
      expect(report.length).toBeGreaterThanOrEqual(1000);
      expect(report.length).toBeLessThanOrEqual(1400);
    });
  }

  it('each world has its own signature hazard and landmark', () => {
    const kinds = Object.keys(WORLDS).map((id) => compileTrack(load(id)));
    expect(kinds.map((t) => t.hazards[0]!.kind)).toEqual(['vent', 'crossing', 'crane', 'stream']);
    expect(kinds.map((t) => t.landmarks[0]!.id)).toEqual(['rune-engine', 'grand-station', 'warlord-idol', 'mother-tree']);
    // Elevation in each world's own way (§7.5): descent, bridge crest, jumps, canopy climb + gap.
    expect(kinds.map((t) => t.jumps.length)).toEqual([0, 0, 2, 1]);
    expect(load('cinderholme-station').pieces.some((p) => p.crest)).toBe(true);
  });

  for (const id of Object.keys(WORLDS)) {
    it(`${id}: two AI racers finish a lap with no repositions`, () => {
      const file = load(id);
      file.laps = 1;
      const sim = new RaceSim(file, [{ spec: HOT_ROD, name: 'a' }, { spec: STEAM_TANK, name: 'b' }], 3);
      const pilots = sim.racers.map((_, i) => createDriver(i, 3, 0));
      let repos = 0;
      for (let n = 0; n < 60 * 120 && sim.phase !== 'finished'; n++) {
        sim.step(pilots.map((p) => driveRacer(p, sim)));
        repos += sim.drainEvents().filter((e) => e.type === 'reposition').length;
        sim.drainRuleEvents();
      }
      expect(sim.phase).toBe('finished');
      expect(repos).toBe(0);
      // Lap time in the target window with no upgrades (doc 04 §4: 55–75 s at a mid upgrade level).
      for (const r of sim.racers) if (r.progress.finishedAt !== null) expect(r.progress.lapTimes[0]!).toBeLessThan(80);
      sim.dispose();
    }, 60_000);
  }
});
