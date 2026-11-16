import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { formatTrackJson } from '../../src/editor/format';

const dir = new URL('../../src/tracks/', import.meta.url);

describe('project JSON layout (doc 05 §10)', () => {
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    it(`${f}: re-formatting reproduces the file`, () => {
      // Hand-wrapped long pieces (a continuation line) count as one line.
      const text = readFileSync(new URL(f, dir), 'utf8').replace(/\r\n/g, '\n').replace(/,\n {6}"/g, ', "');
      expect(formatTrackJson(JSON.parse(text))).toBe(text);
    });
  }
});
