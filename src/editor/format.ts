/**
 * JSON layout of the files the editor writes into the project (doc 05 §10): the style of the
 * hand-written tracks, so saving a standard track gives a clean diff. Top-level keys one per line,
 * one piece (or tile, or Cup round) per line, everything inside a line inline:
 * `{ "type": "curve", "size": 2, "lanes": [-1, 0], "pickups": [{ "kind": "coal" }] }`.
 */

/** One value on one line. */
export function inline(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    return entries.length ? `{ ${entries.map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }` : '{}';
  }
  return JSON.stringify(v);
}

/** A list with one item per line, at `indent` spaces. */
function list(items: readonly unknown[], indent: number): string {
  if (!items.length) return '[]';
  const pad = ' '.repeat(indent + 2);
  return `[\n${items.map((x) => pad + inline(x)).join(',\n')}\n${' '.repeat(indent)}]`;
}

/**
 * An object with one key per line; keys listed in `lists` are written one item per line, keys in
 * `nested` as objects of their own (same rules, one level deeper).
 */
function block(obj: Record<string, unknown>, indent: number, lists: readonly string[], nested: readonly string[] = []): string {
  const pad = ' '.repeat(indent + 2);
  const lines = Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => {
      const key = `${pad}${JSON.stringify(k)}: `;
      if (lists.includes(k) && Array.isArray(v)) return key + list(v, indent + 2);
      if (nested.includes(k) && v && typeof v === 'object' && !Array.isArray(v)) return key + block(v as Record<string, unknown>, indent + 2, lists);
      return key + inline(v);
    });
  return `{\n${lines.join(',\n')}\n${' '.repeat(indent)}}`;
}

/** A track file (`src/tracks/<id>.json`). */
export function formatTrackJson(file: object): string {
  return block(file as Record<string, unknown>, 0, ['pieces', 'tiles'], ['editor']) + '\n';
}

/** The Cup configuration (`src/cup/cups.json`). */
export function formatCupsJson(cups: object): string {
  return block(cups as Record<string, unknown>, 0, ['rounds']) + '\n';
}
