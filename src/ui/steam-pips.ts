/**
 * Steam-point pips shared by the under-vehicle tag and the touch STEAM button ring.
 * Pure logic, unit tested. Fed by the boiler (rules/boiler.ts).
 */

export type PipKind =
  /** Full and spendable now. */
  | 'ready'
  /** Full, above CAL (red zone), spendable now. */
  | 'red'
  /** Full but not spendable (push cooling down, or not enough PV for one push). */
  | 'grey'
  /** Not full; `fill` is the passive regen progress (drawn grey). */
  | 'empty';

export interface Pip {
  kind: PipKind;
  /** 0..1, only meaningful for 'empty' (regen progress of the next PV). */
  fill: number;
}

export interface SteamReadout {
  pv: number;
  cal: number;
  /** 0..1 progress of the next passive PV. */
  regen: number;
  /** A push would fire right now. */
  usable: boolean;
}

/** CAL slots always shown; PV above CAL add red slots on the right. */
export function steamPips(r: SteamReadout): Pip[] {
  const cal = Math.max(1, Math.round(r.cal));
  const pv = Math.max(0, Math.floor(r.pv));
  const n = Math.max(cal, pv);
  const pips: Pip[] = [];
  for (let k = 0; k < n; k++) {
    if (k < pv) pips.push({ kind: r.usable ? (k < cal ? 'ready' : 'red') : 'grey', fill: 1 });
    else pips.push({ kind: 'empty', fill: k === pv ? clamp01(r.regen) : 0 });
  }
  return pips;
}

/** Stable key so per-frame DOM writers only touch the DOM when something visible changed. */
export function pipsKey(pips: Pip[]): string {
  return pips.map((p) => (p.kind === 'empty' ? `e${Math.round(p.fill * 10)}` : PIP_CHAR[p.kind])).join('');
}

/** One letter per kind (R = ready, X = red zone, G = grey, E = empty). */
export const PIP_CHAR: Record<PipKind, string> = { ready: 'R', red: 'X', grey: 'G', empty: 'E' };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
