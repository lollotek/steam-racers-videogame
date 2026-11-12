/**
 * Central registry of every parameter that affects gameplay or rendering (doc 03 §15.1).
 * Systems read values through `get()` (or keep the returned handle), the debug panel
 * builds its UI from the registry, and presets are plain JSON key → value maps.
 */
export type TunableValue = number | boolean | string;

interface BaseDef {
  key: string;
  group: string;
  label?: string;
  description?: string;
}
export interface NumberDef extends BaseDef {
  type: 'number';
  default: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}
export interface BoolDef extends BaseDef {
  type: 'boolean';
  default: boolean;
}
export interface ColorDef extends BaseDef {
  type: 'color';
  default: string;
}
export interface OptionDef extends BaseDef {
  type: 'option';
  default: string;
  options: readonly string[];
}
export type TunableDef = NumberDef | BoolDef | ColorDef | OptionDef;

type DefaultOf<D extends TunableDef> = D['default'];
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export interface Tunable<T extends TunableValue> {
  readonly def: TunableDef;
  value: T;
}

export type Preset = Record<string, TunableValue>;

type Listener = (key: string, value: TunableValue) => void;

export class TunableRegistry {
  private entries = new Map<string, Tunable<TunableValue>>();
  private listeners = new Set<Listener>();

  register<D extends TunableDef>(def: D): Tunable<DefaultOf<D>> {
    const existing = this.entries.get(def.key);
    if (existing) return existing as Tunable<DefaultOf<D>>;
    const t: Tunable<TunableValue> = { def, value: def.default };
    this.entries.set(def.key, t);
    return t as Tunable<DefaultOf<D>>;
  }

  /** Register many defs under one group prefix. */
  registerGroup(group: string, defs: DistributiveOmit<TunableDef, 'group'>[]): void {
    for (const d of defs) this.register({ ...d, group } as TunableDef);
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  get<T extends TunableValue = number>(key: string): T {
    const t = this.entries.get(key);
    if (!t) throw new Error(`Unknown tunable: ${key}`);
    return t.value as T;
  }

  set(key: string, value: TunableValue): void {
    const t = this.entries.get(key);
    if (!t) return;
    const v = sanitize(t.def, value);
    if (v === undefined || v === t.value) return;
    t.value = v;
    for (const l of this.listeners) l(key, v);
  }

  reset(key?: string): void {
    if (key) {
      const t = this.entries.get(key);
      if (t) this.set(key, t.def.default);
      return;
    }
    for (const [k, t] of this.entries) this.set(k, t.def.default);
  }

  all(): Tunable<TunableValue>[] {
    return [...this.entries.values()];
  }

  groups(): string[] {
    return [...new Set(this.all().map((t) => t.def.group))];
  }

  /** Only values that differ from defaults. */
  toPreset(onlyChanged = true): Preset {
    const out: Preset = {};
    for (const [k, t] of this.entries) if (!onlyChanged || t.value !== t.def.default) out[k] = t.value;
    return out;
  }

  /** Applies known keys, ignores unknown ones; returns the number of applied keys. */
  applyPreset(preset: Preset): number {
    let n = 0;
    for (const [k, v] of Object.entries(preset)) {
      if (this.entries.has(k)) {
        this.set(k, v);
        n++;
      }
    }
    return n;
  }

  onChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

function sanitize(def: TunableDef, value: TunableValue): TunableValue | undefined {
  switch (def.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return undefined;
      return Math.min(def.max, Math.max(def.min, n));
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : value === 'true';
    case 'color':
      return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : undefined;
    case 'option':
      return typeof value === 'string' && def.options.includes(value) ? value : undefined;
  }
}

/** The game-wide registry instance. */
export const tunables = new TunableRegistry();
