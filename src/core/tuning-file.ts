/**
 * Playtest tuning files: a named set of tunable values a playtester can import from the title
 * screen (usually written with the help of an LLM, see public/tuning/). The active file is kept in
 * localStorage and applied at every boot until reset.
 *
 * {
 *   "format": "steam-racers-tuning",
 *   "version": 1,
 *   "name": "Forgiving boiler",
 *   "notes": "why these values",
 *   "params": { "boiler.regenTime": 1.2, "handling.maxSpeed": 36 }
 * }
 *
 * Parsing is lenient on purpose (LLM output): code fences and text around the JSON are dropped,
 * a bare `{ key: value }` map is accepted, nested groups (`{ "boiler": { "regenTime": 1 } }`) are
 * flattened, numbers given as strings are read. Every fix is reported as a warning.
 */
import { type Preset, type TunableRegistry, type TunableValue, sanitize } from './tunables';

export const TUNING_FORMAT = 'steam-racers-tuning';
export const TUNING_VERSION = 1;
export const TUNING_STORAGE_KEY = 'sr.playtestTuning';

/** Groups registered only when a race starts: their keys are accepted before they exist. */
export const LATE_GROUPS: readonly string[] = ['quality', 'sim'];

export interface TuningFile {
  format: typeof TUNING_FORMAT;
  version: number;
  name: string;
  author?: string;
  notes?: string;
  params: Preset;
}

export interface ParsedTuning {
  file: TuningFile;
  warnings: string[];
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** The JSON object inside `text` (plain JSON, a ```json fence, or JSON with prose around it). */
export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^﻿/, '');
  try {
    return JSON.parse(t);
  } catch {
    /* try the fenced / embedded forms below */
  }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      /* fall through */
    }
  }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('No JSON object found');
}

const isObject = (v: unknown): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v);

function flatten(obj: Record<string, Json>, prefix: string, out: Record<string, Json>): void {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isObject(v)) flatten(v, key, out);
    else out[key] = v;
  }
}

function fmt(v: unknown): string {
  return typeof v === 'string' ? `"${v}"` : String(v);
}

/** Reads a tuning file (or a bare preset map) and checks every value against the registry. */
export function parseTuning(text: string, registry: TunableRegistry): ParsedTuning {
  const raw = extractJson(text);
  if (!isObject(raw)) throw new Error('The tuning must be a JSON object');
  const warnings: string[] = [];

  const isFile = 'params' in raw || 'format' in raw;
  if (isFile && raw.format !== undefined && raw.format !== TUNING_FORMAT) warnings.push(`Unexpected format ${fmt(raw.format)} (expected "${TUNING_FORMAT}"): read anyway`);
  if (isFile && typeof raw.version === 'number' && raw.version > TUNING_VERSION) warnings.push(`File version ${raw.version} is newer than this game (${TUNING_VERSION})`);
  const source = isFile ? raw.params : raw;
  if (!isObject(source)) throw new Error('"params" must be an object of parameter → value');

  const flat: Record<string, Json> = {};
  flatten(source, '', flat);

  const params: Preset = {};
  for (const [key, value] of Object.entries(flat)) {
    const t = registry.all().find((x) => x.def.key === key);
    if (!t) {
      const late = LATE_GROUPS.some((g) => key.startsWith(`${g}.`));
      if (late && (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string')) params[key] = value;
      else warnings.push(`Unknown parameter "${key}": ignored`);
      continue;
    }
    const def = t.def;
    if (typeof value !== 'number' && typeof value !== 'boolean' && typeof value !== 'string') {
      warnings.push(`${key}: ${fmt(JSON.stringify(value))} is not a ${def.type}: ignored`);
      continue;
    }
    if (def.type === 'number' && typeof value === 'string') warnings.push(`${key}: number given as text ${fmt(value)}`);
    if (def.type === 'boolean' && typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
      warnings.push(`${key}: ${fmt(value)} is not true/false: ignored`);
      continue;
    }
    const v = sanitize(def, value as TunableValue);
    if (v === undefined) {
      const expected = def.type === 'option' ? `one of ${def.options.join(', ')}` : def.type === 'color' ? 'a #RRGGBB colour' : `a ${def.type}`;
      warnings.push(`${key}: ${fmt(value)} is not ${expected}: ignored`);
      continue;
    }
    if (def.type === 'number' && v !== Number(value)) warnings.push(`${key}: ${value} is outside ${def.min}…${def.max}, clamped to ${v}`);
    params[key] = v;
  }

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const file: TuningFile = {
    format: TUNING_FORMAT,
    version: TUNING_VERSION,
    name: (isFile && str(raw.name)) || 'Untitled tuning',
    params,
  };
  const author = isFile ? str(raw.author) : undefined;
  const notes = isFile ? str(raw.notes) : undefined;
  if (author) file.author = author;
  if (notes) file.notes = notes;
  return { file, warnings };
}

/** The current values as a tuning file (by default only the ones that differ from the defaults). */
export function buildTuningFile(registry: TunableRegistry, opts: { name: string; notes?: string; author?: string; onlyChanged?: boolean }): TuningFile {
  const preset = registry.toPreset(opts.onlyChanged ?? true);
  const params: Preset = {};
  for (const k of Object.keys(preset).sort()) params[k] = preset[k]!;
  const file: TuningFile = { format: TUNING_FORMAT, version: TUNING_VERSION, name: opts.name, params };
  if (opts.author) file.author = opts.author;
  if (opts.notes) file.notes = opts.notes;
  return file;
}

/** Back to the defaults, then the file's values on top (late-group keys wait for registration). */
export function applyTuning(registry: TunableRegistry, file: TuningFile | null): void {
  registry.reset();
  if (file) registry.applyPreset(file.params, true);
}

export function loadStoredTuning(store: Storage | null): TuningFile | null {
  try {
    const txt = store?.getItem(TUNING_STORAGE_KEY);
    if (!txt) return null;
    const f = JSON.parse(txt) as TuningFile;
    return isObject(f) && isObject(f.params) ? f : null;
  } catch {
    return null;
  }
}

export function storeTuning(store: Storage | null, file: TuningFile | null): void {
  try {
    if (file) store?.setItem(TUNING_STORAGE_KEY, JSON.stringify(file));
    else store?.removeItem(TUNING_STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode): the tuning lasts this session only */
  }
}
