/**
 * Compile track files and check them against the Cup track rules (doc 04 §4).
 *   npx tsx tools/track/check.ts [id ...]        (default: every file in src/tracks)
 * Prints the closure error (where the chain ends) or the rules report.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { compileTrack } from '../../src/track/compile';
import { checkTrack } from '../../src/track/rules';
import type { TrackFile } from '../../src/track/track-format';

const dir = new URL('../../src/tracks/', import.meta.url);
const ids = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
let bad = 0;
for (const id of ids) {
  const file = JSON.parse(readFileSync(new URL(`${id}.json`, dir), 'utf8')) as TrackFile;
  try {
    const t = compileTrack(file);
    const r = checkTrack(t);
    const b = t.bounds;
    console.log(
      `${id}: ${r.length} m, straight ${r.longestStraight} m, hairpins ${r.hairpins}, tight ${r.tightCorners}, jumps ${r.jumps}, height ${r.heightRange.toFixed(1)} m, ` +
        `${Math.round(b.maxX - b.minX)}×${Math.round(b.maxZ - b.minZ)} m\n  surfaces ${r.surfaces.join(' ')}\n  barricades ${r.barricades.join(' ')}\n  hazards ${r.hazards}, landmarks ${r.landmarks}` +
        (r.problems.length ? `\n  ⚠ ${r.problems.join('; ')}` : '\n  ✓ Cup rules'),
    );
  } catch (e) {
    bad++;
    console.log(`${id}: ✗ ${(e as Error).message}`);
  }
}
process.exit(bad ? 1 : 0);
