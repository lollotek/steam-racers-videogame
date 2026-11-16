/**
 * Dev-only "save to project" for the track editor (doc 05 §10). The Vite dev server answers
 * `POST /__editor/save` with a JSON body:
 *   { "kind": "track", "file": TrackFile }   → src/tracks/<file.id>.json
 *   { "kind": "cups",  "cups": CupConfig }   → src/cup/cups.json
 * and writes the file in the project's JSON layout (src/editor/format.ts). Only requests from the
 * dev server's own pages are accepted (same origin, JSON). Never part of a build.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { formatCupsJson, formatTrackJson } from '../../src/editor/format';

export const SAVE_PATH = '/__editor/save';
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface SaveResult {
  status: number;
  body: { ok: boolean; path?: string; created?: boolean; error?: string };
}

/** Validate and write one save request under `root` (the project folder). Pure apart from the write. */
export function saveFromEditor(root: string, req: unknown): SaveResult {
  const bad = (error: string): SaveResult => ({ status: 400, body: { ok: false, error } });
  if (!req || typeof req !== 'object') return bad('Expected a JSON object');
  const r = req as { kind?: string; file?: Record<string, unknown>; cups?: Record<string, unknown> };
  if (r.kind === 'track') {
    const f = r.file;
    if (!f || typeof f.id !== 'string' || !ID.test(f.id)) return bad('The track id must be lower-case letters, digits and dashes');
    if (!Array.isArray(f.pieces) || !f.pieces.length) return bad('The track has no pieces');
    const rel = `src/tracks/${f.id}.json`;
    const path = join(root, rel);
    const created = !existsSync(path);
    writeFileSync(path, formatTrackJson(f));
    return { status: 200, body: { ok: true, path: rel, created } };
  }
  if (r.kind === 'cups') {
    const c = r.cups;
    if (!c || typeof c.name !== 'string' || !Array.isArray(c.rounds) || !c.rounds.length) return bad('The Cup needs a name and at least one race');
    for (const round of c.rounds as Record<string, unknown>[]) if (typeof round?.trackId !== 'string' || !ID.test(round.trackId)) return bad('Every race needs a track id');
    const rel = 'src/cup/cups.json';
    writeFileSync(join(root, rel), formatCupsJson(c));
    return { status: 200, body: { ok: true, path: rel, created: false } };
  }
  return bad('Unknown kind (expected "track" or "cups")');
}

export function editorSave(): Plugin {
  return {
    name: 'editor-save',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      server.middlewares.use(SAVE_PATH, (req, res) => {
        const send = (r: SaveResult) => {
          res.statusCode = r.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(r.body));
        };
        if (req.method !== 'POST') return send({ status: 405, body: { ok: false, error: 'POST only' } });
        // Same origin only: a page on another site must not write into the project.
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) return send({ status: 403, body: { ok: false, error: 'Cross-origin request refused' } });
        if (!String(req.headers['content-type']).startsWith('application/json')) return send({ status: 415, body: { ok: false, error: 'Expected application/json' } });
        let raw = '';
        req.setEncoding('utf8');
        req.on('data', (chunk: string) => {
          raw += chunk;
          if (raw.length > 2_000_000) req.destroy();
        });
        req.on('end', () => {
          try {
            send(saveFromEditor(root, JSON.parse(raw)));
          } catch (e) {
            send({ status: 400, body: { ok: false, error: (e as Error).message } });
          }
        });
      });
    },
  };
}
