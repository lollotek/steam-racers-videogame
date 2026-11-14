/**
 * Editor state (doc 05 §5): the document with undo / redo, the selection, the tool being placed,
 * the live validation and the autosave of the last track.
 */
import { computed, signal } from '@preact/signals';
import type { Piece } from '../track/track-format';
import {
  type Dir,
  type EditorDoc,
  type Socket,
  type Tile,
  canPlace,
  docFromFile,
  newDoc,
  nextId,
  normalize,
  reverseTile,
  rotateTile,
  toTrackFile,
  validateDoc,
} from './layout';

export const AUTOSAVE_KEY = 'steamRacers.editor.doc';

/** Palette entries (doc 05 §5). */
export interface PaletteItem {
  key: string;
  label: string;
  piece: Piece;
}
export const PALETTE: PaletteItem[] = [
  { key: 'start', label: 'Start', piece: { type: 'start', size: 3 } },
  { key: 'straight', label: 'Straight', piece: { type: 'straight', size: 1 } },
  { key: 'ramp-up', label: 'Ramp up', piece: { type: 'straight', size: 2, rise: 1 } },
  { key: 'ramp-down', label: 'Ramp down', piece: { type: 'straight', size: 2, rise: -1 } },
  { key: 'crest', label: 'Crest', piece: { type: 'straight', size: 2, crest: 2 } },
  { key: 'curve1', label: 'Curve 1', piece: { type: 'curve', size: 1, turn: 'R' } },
  { key: 'curve2', label: 'Curve 2', piece: { type: 'curve', size: 2, turn: 'R' } },
  { key: 'curve3', label: 'Curve 3', piece: { type: 'curve', size: 3, turn: 'R' } },
  { key: 'jump', label: 'Jump', piece: { type: 'jump', size: 2 } },
];

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function loadAutosave(): EditorDoc {
  try {
    const raw = storage()?.getItem(AUTOSAVE_KEY);
    if (raw) return normalize(docFromFile(JSON.parse(raw)));
  } catch (e) {
    console.warn('[editor] autosave unreadable, starting a new track', e);
  }
  return newDoc();
}

export const doc = signal<EditorDoc>(loadAutosave());
export const selected = signal<number | null>(null);
/** Palette key of the piece being placed (null = select / move). */
export const tool = signal<string | null>(null);
/** Rotation and turn of the piece being placed. */
export const toolDir = signal<Dir>(0);
export const toolTurn = signal<'L' | 'R'>('R');
export const message = signal<{ text: string; kind: 'info' | 'error' } | null>(null);

const past: EditorDoc[] = [];
const future: EditorDoc[] = [];
export const historyTick = signal(0);

export const validation = computed(() => validateDoc(doc.value));

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function autosave(d: EditorDoc): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      storage()?.setItem(AUTOSAVE_KEY, JSON.stringify(toTrackFile(d)));
    } catch {
      /* quota / private mode: the track only lives in this tab */
    }
  }, 300);
}

/** Apply an edit (undoable). Tiles driven backwards are normalised. */
export function commit(next: EditorDoc, keepFuture = false): void {
  past.push(doc.value);
  if (past.length > 200) past.shift();
  if (!keepFuture) future.length = 0;
  doc.value = normalize(next);
  if (selected.value !== null && !doc.value.tiles.some((t) => t.id === selected.value)) selected.value = null;
  historyTick.value++;
  autosave(doc.value);
}

export function undo(): void {
  const prev = past.pop();
  if (!prev) return;
  future.push(doc.value);
  doc.value = prev;
  historyTick.value++;
  autosave(prev);
}

export function redo(): void {
  const next = future.pop();
  if (!next) return;
  past.push(doc.value);
  doc.value = next;
  historyTick.value++;
  autosave(next);
}

export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;

export function replaceDoc(d: EditorDoc): void {
  selected.value = null;
  tool.value = null;
  commit(d);
  fitRequest.value++;
}

export function notify(text: string, kind: 'info' | 'error' = 'info'): void {
  message.value = { text, kind };
}

// --- Editing operations ------------------------------------------------------------------------------

export function toolPiece(): Piece | null {
  const item = PALETTE.find((p) => p.key === tool.value);
  if (!item) return null;
  const piece = structuredClone(item.piece);
  if (piece.type === 'curve') piece.turn = toolTurn.value;
  return piece;
}

/** Ghost of the piece being placed at a cell (oriented to the open end when hovering it). */
export function ghostAt(x: number, z: number): (Socket & { piece: Piece; ok: boolean }) | null {
  const piece = toolPiece();
  if (!piece) return null;
  const end = validation.value.chain.openEnd;
  const dir = end && end.x === x && end.z === z ? end.dir : toolDir.value;
  const s = { x, z, dir, piece };
  return { ...s, ok: canPlace(doc.value.tiles, s) && !(piece.type === 'start' && doc.value.tiles.some((t) => t.piece.type === 'start')) };
}

export function placeAt(x: number, z: number): boolean {
  const g = ghostAt(x, z);
  if (!g) return false;
  if (!g.ok) {
    notify(g.piece.type === 'start' ? 'There is already a start tile' : 'That space is taken', 'error');
    return false;
  }
  const d = doc.value;
  const id = nextId(d.tiles);
  commit({ ...d, tiles: [...d.tiles, { id, x: g.x, z: g.z, dir: g.dir, piece: g.piece }] });
  message.value = null;
  return true;
}

/** Enter: put the current piece at the open end. */
export function appendAtEnd(): void {
  const end = validation.value.chain.openEnd;
  if (!end) return notify(validation.value.chain.closed ? 'The track is closed' : 'No open end to continue from', 'error');
  if (!tool.value) tool.value = 'straight';
  placeAt(end.x, end.z);
}

const tileById = (id: number | null) => doc.value.tiles.find((t) => t.id === id);

export function updateTile(id: number, fn: (t: Tile) => Tile | null): boolean {
  const d = doc.value;
  const t = d.tiles.find((o) => o.id === id);
  if (!t) return false;
  const n = fn(structuredClone(t));
  if (!n) return false;
  if (!canPlace(d.tiles, n, id)) {
    notify('No room for that: another tile is in the way', 'error');
    return false;
  }
  commit({ ...d, tiles: d.tiles.map((o) => (o.id === id ? n : o)) });
  return true;
}

export function updatePiece(id: number, fn: (p: Piece) => Piece): boolean {
  return updateTile(id, (t) => ({ ...t, piece: fn(t.piece) }));
}

export function deleteSelected(): void {
  const t = tileById(selected.value);
  if (!t) return;
  commit({ ...doc.value, tiles: doc.value.tiles.filter((o) => o.id !== t.id) });
  selected.value = null;
}

export function rotate(quarter = 1): void {
  const t = tileById(selected.value);
  if (tool.value) toolDir.value = (((toolDir.value + quarter) % 4) + 4) % 4 as Dir;
  else if (t) updateTile(t.id, (o) => rotateTile(o, quarter));
}

export function flip(): void {
  const t = tileById(selected.value);
  if (tool.value) toolTurn.value = toolTurn.value === 'L' ? 'R' : 'L';
  else if (t?.piece.type === 'curve') updatePiece(t.id, (p) => ({ ...p, turn: p.turn === 'L' ? 'R' : 'L' }));
}

export function reverseSelected(): void {
  const t = tileById(selected.value);
  if (!t) return;
  if (t.piece.type === 'start') return notify('The start sets the direction of the race: rotate it instead', 'error');
  // Explicit reversal: a jump flips; any other tile keeps its connection (normalised back if it is in the chain).
  updateTile(t.id, (o) => reverseTile(o));
}

export function moveTile(id: number, x: number, z: number): boolean {
  return updateTile(id, (t) => ({ ...t, x, z }));
}

/** Ask the grid to frame the whole track (after loading a track). */
export const fitRequest = signal(0);
