import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveFromEditor } from '../../tools/vite/editor-save';
import { CUP_CONFIG, CUP_ROUNDS } from '../../src/cup/cup';
import { TRACKS } from '../../src/tracks';

const project = () => {
  const root = mkdtempSync(join(tmpdir(), 'sr-save-'));
  mkdirSync(join(root, 'src/tracks'), { recursive: true });
  mkdirSync(join(root, 'src/cup'), { recursive: true });
  return root;
};

describe('editor save to project (doc 05 §10)', () => {
  it('writes a track in the project layout, reports new vs overwritten', () => {
    const root = project();
    const file = { ...TRACKS['rustmaw-pit']!, id: 'my-track' };
    const a = saveFromEditor(root, { kind: 'track', file });
    expect(a).toEqual({ status: 200, body: { ok: true, path: 'src/tracks/my-track.json', created: true } });
    expect(JSON.parse(readFileSync(join(root, 'src/tracks/my-track.json'), 'utf8'))).toEqual(file);
    expect(saveFromEditor(root, { kind: 'track', file }).body.created).toBe(false);
  });

  it('refuses bad ids and unknown kinds (no path tricks)', () => {
    const root = project();
    expect(saveFromEditor(root, { kind: 'track', file: { id: '../evil', pieces: [{}] } }).status).toBe(400);
    expect(saveFromEditor(root, { kind: 'track', file: { id: 'Upper', pieces: [{}] } }).status).toBe(400);
    expect(saveFromEditor(root, { kind: 'other' }).status).toBe(400);
    expect(saveFromEditor(root, { kind: 'cups', cups: { name: 'x', rounds: [] } }).status).toBe(400);
  });

  it('writes the Cup configuration', () => {
    const root = project();
    expect(saveFromEditor(root, { kind: 'cups', cups: CUP_CONFIG }).body.ok).toBe(true);
    expect(JSON.parse(readFileSync(join(root, 'src/cup/cups.json'), 'utf8'))).toEqual(CUP_CONFIG);
  });

  it('every Cup race names a track of the project', () => {
    for (const r of CUP_ROUNDS) expect(TRACKS[r.trackId], r.trackId).toBeDefined();
  });
});
