/**
 * Start test (gameplay.md §4), pure and deterministic.
 * During the countdown a needle rises while STEAM is held and falls when released. It must stay in
 * the green band (wider with MAN and for pole position; more tolerance above it with AFF).
 * At GO, the share of the last `window` seconds spent in the band decides the outcome:
 *   perfect → long free push, start in 3rd · good → short free push, 2nd · normal → 1st
 *   stall   → needle at zero or in the red zone at GO: engine off for a moment.
 */
import { tunables } from '../core/tunables';

tunables.registerGroup('start', [
  { key: 'start.riseRate', type: 'number', default: 0.9, min: 0.1, max: 4, step: 0.05, unit: '/s', label: 'Needle rise (STEAM held)' },
  { key: 'start.fallRate', type: 'number', default: 0.7, min: 0.1, max: 4, step: 0.05, unit: '/s', label: 'Needle fall (released)' },
  { key: 'start.bandCentre', type: 'number', default: 0.62, min: 0.2, max: 0.9, step: 0.01, label: 'Green band centre' },
  { key: 'start.bandWidth', type: 'number', default: 0.14, min: 0.02, max: 0.5, step: 0.01, label: 'Green band width' },
  { key: 'start.manBand', type: 'number', default: 0.015, min: 0, max: 0.1, step: 0.005, label: 'Band width per MAN' },
  { key: 'start.poleBonus', type: 'number', default: 0.03, min: 0, max: 0.2, step: 0.005, label: 'Band width bonus: pole position' },
  { key: 'start.affTolerance', type: 'number', default: 0.012, min: 0, max: 0.1, step: 0.002, label: 'Tolerance above band per AFF' },
  { key: 'start.redLine', type: 'number', default: 0.9, min: 0.5, max: 1, step: 0.01, label: 'Red zone (stall at GO)' },
  { key: 'start.window', type: 'number', default: 1.5, min: 0.25, max: 3, step: 0.05, unit: 's', label: 'Judged window before GO' },
  { key: 'start.perfect', type: 'number', default: 0.85, min: 0.3, max: 1, step: 0.01, label: 'Perfect: share in band' },
  { key: 'start.good', type: 'number', default: 0.5, min: 0.1, max: 1, step: 0.01, label: 'Good: share in band' },
  { key: 'start.perfectPush', type: 'number', default: 1.8, min: 0, max: 5, step: 0.1, unit: 's', label: 'Perfect: free push' },
  { key: 'start.goodPush', type: 'number', default: 0.8, min: 0, max: 5, step: 0.1, unit: 's', label: 'Good: free push' },
  { key: 'start.stall', type: 'number', default: 1.2, min: 0, max: 5, step: 0.1, unit: 's', label: 'Stall: engine off' },
  { key: 'start.calmTime', type: 'number', default: 2.5, min: 0, max: 10, step: 0.25, unit: 's', label: 'After GO: no pushes, no fire' },
]);

export type StartOutcome = 'perfect' | 'good' | 'normal' | 'stall';

export interface StartTest {
  needle: number;
  lo: number;
  hi: number;
  /** Extra tolerance above `hi` (AFF). */
  tol: number;
  /** Time in band / time judged, inside the window. */
  inBand: number;
  judged: number;
  outcome: StartOutcome | null;
}

export function createStartTest(man: number, aff: number, pole: boolean): StartTest {
  const t = (k: string) => tunables.get<number>(k);
  const half = (t('start.bandWidth') + man * t('start.manBand') + (pole ? t('start.poleBonus') : 0)) / 2;
  const c = t('start.bandCentre');
  return { needle: 0, lo: c - half, hi: c + half, tol: aff * t('start.affTolerance'), inBand: 0, judged: 0, outcome: null };
}

export function inStartBand(s: StartTest): boolean {
  return s.needle >= s.lo && s.needle <= s.hi + s.tol;
}

/**
 * @param timeToGo seconds left before GO (> 0 during the countdown)
 */
export function stepStartTest(s: StartTest, held: boolean, dt: number, timeToGo: number): void {
  const t = (k: string) => tunables.get<number>(k);
  s.needle = Math.max(0, Math.min(1, s.needle + (held ? t('start.riseRate') : -t('start.fallRate')) * dt));
  if (timeToGo <= t('start.window')) {
    s.judged += dt;
    if (inStartBand(s)) s.inBand += dt;
  }
}

export function resolveStart(s: StartTest): StartOutcome {
  const t = (k: string) => tunables.get<number>(k);
  let o: StartOutcome;
  if (s.needle <= 0.001 || s.needle >= t('start.redLine')) o = 'stall';
  else {
    const share = s.judged > 0 ? s.inBand / s.judged : 0;
    o = share >= t('start.perfect') ? 'perfect' : share >= t('start.good') ? 'good' : 'normal';
  }
  s.outcome = o;
  return o;
}

/** Gear and free push for an outcome. */
export function startEffect(o: StartOutcome): { gear: number; push: number; stall: number } {
  const t = (k: string) => tunables.get<number>(k);
  switch (o) {
    case 'perfect':
      return { gear: 3, push: t('start.perfectPush'), stall: 0 };
    case 'good':
      return { gear: 2, push: t('start.goodPush'), stall: 0 };
    case 'normal':
      return { gear: 1, push: 0, stall: 0 };
    case 'stall':
      return { gear: 1, push: 0, stall: t('start.stall') };
  }
}
