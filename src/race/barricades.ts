/**
 * Track edges as an invisible rail (gameplay.md §6.3, doc 03 §7.4).
 *
 * The edge is a rule, not a geometry: the vehicle is kept inside a smooth lateral limit measured
 * from the centre line, so there are no posts, seams or corners to get stuck on. What the player
 * sees on the edge (the barricade type of the piece) only selects the reaction:
 *   scrape → slowed down while in contact (always slower than the clean line)
 *   hit    → glancing impact: speed loss, the car is deflected along the edge
 *   crash  → frontal impact: full stop, restart in 1st gear
 * Damage (PF) is applied from the same events in M3.
 */
import { tunables } from '../core/tunables';
import type { Barricade } from '../track/track-format';

export const BARRICADES: readonly Barricade[] = ['earth', 'riveted', 'hedgehog', 'corrugated', 'sandbags', 'barbed', 'stone', 'runepylon', 'ironrail', 'wreckwall', 'tyres', 'roots', 'crystal'];

interface BarricadeDefaults {
  /** Top speed while scraping, as a fraction of the vehicle max speed. */
  scrapeSpeed: number;
  /** Deceleration towards that speed (m/s²). */
  scrapeDrag: number;
  /** Fraction of the speed lost in a glancing hit at crash-level normal speed. */
  hitLoss: number;
  /** Multiplier on the crash threshold (soft edges absorb violent hits). */
  crashScale: number;
  /** Gears lost on a hit. */
  gearLoss: number;
  /** Distance of the edge face from the nominal track edge (m, + = outside). */
  inset: number;
}

const DEFAULTS: Record<Barricade, BarricadeDefaults> = {
  // Bare earth: forgiving, drags a little.
  earth: { scrapeSpeed: 0.7, scrapeDrag: 8, hitLoss: 0.2, crashScale: 1.15, gearLoss: 0, inset: 0 },
  // Riveted plates: the smooth reinforced wall. Slides, only slightly slowed.
  riveted: { scrapeSpeed: 0.85, scrapeDrag: 5, hitLoss: 0.25, crashScale: 1, gearLoss: 0, inset: 0.4 },
  // Czech hedgehogs: spikes. Heavy slowdown (and damage ticks in M3).
  hedgehog: { scrapeSpeed: 0.45, scrapeDrag: 16, hitLoss: 0.45, crashScale: 0.85, gearLoss: 0, inset: 0 },
  corrugated: { scrapeSpeed: 0.75, scrapeDrag: 8, hitLoss: 0.3, crashScale: 1, gearLoss: 0, inset: 0.4 },
  // Sandbags: absorb the violent hit but brake the scrape hard.
  sandbags: { scrapeSpeed: 0.5, scrapeDrag: 14, hitLoss: 0.15, crashScale: 1.6, gearLoss: 0, inset: 0 },
  // Barbed wire: no damage, but a gear is lost and the car is held back.
  barbed: { scrapeSpeed: 0.55, scrapeDrag: 12, hitLoss: 0.2, crashScale: 1.3, gearLoss: 1, inset: 0.5 },
  // v2 (doc 04 §5).
  // Dwarven stone parapet: hard like riveted plates, a little rougher.
  stone: { scrapeSpeed: 0.8, scrapeDrag: 6, hitLoss: 0.3, crashScale: 0.95, gearLoss: 0, inset: 0.4 },
  // Rune pylons: smooth arc field, no damage, but contact drains steam (race-rules).
  runepylon: { scrapeSpeed: 0.8, scrapeDrag: 6, hitLoss: 0.2, crashScale: 1.1, gearLoss: 0, inset: 0.5 },
  // Victorian cast-iron railing: smooth scrape, damage only at violent hits.
  ironrail: { scrapeSpeed: 0.85, scrapeDrag: 4, hitLoss: 0.25, crashScale: 1.05, gearLoss: 0, inset: 0.3 },
  // Orc wreck wall: piled car wrecks, like hedgehogs.
  wreckwall: { scrapeSpeed: 0.5, scrapeDrag: 14, hitLoss: 0.45, crashScale: 0.85, gearLoss: 0, inset: 0.2 },
  // Tyre stacks: soft, absorb crashes, slow the scrape.
  tyres: { scrapeSpeed: 0.55, scrapeDrag: 12, hitLoss: 0.15, crashScale: 1.7, gearLoss: 0, inset: 0.2 },
  // Elven living roots: soft, slow like sandbags.
  roots: { scrapeSpeed: 0.5, scrapeDrag: 13, hitLoss: 0.15, crashScale: 1.5, gearLoss: 0, inset: 0 },
  // Elven crystal rail: hard and slippery: almost no scrape slowdown.
  crystal: { scrapeSpeed: 0.92, scrapeDrag: 3, hitLoss: 0.3, crashScale: 1, gearLoss: 0, inset: 0.4 },
};

tunables.registerGroup('barricades', [
  { key: 'barricades.crashSpeed', type: 'number', default: 9, min: 2, max: 30, step: 0.5, unit: 'm/s', label: 'Crash: speed into the edge' },
  { key: 'barricades.crashAngle', type: 'number', default: 45, min: 10, max: 89, step: 1, unit: '°', label: 'Crash: min impact angle' },
  { key: 'barricades.crashStun', type: 'number', default: 0.7, min: 0, max: 3, step: 0.05, unit: 's', label: 'Crash: stop time' },
  { key: 'barricades.hitMinSpeed', type: 'number', default: 1.5, min: 0, max: 10, step: 0.1, unit: 'm/s', label: 'Hit: min speed into the edge' },
  { key: 'barricades.alignRate', type: 'number', default: 2.6, min: 0.2, max: 8, step: 0.1, unit: 'rad/s', label: 'Nose realign rate on contact' },
  { key: 'barricades.contactBand', type: 'number', default: 0.3, min: 0.02, max: 1, step: 0.01, unit: 'm', label: 'Contact band (scrape distance)' },
  { key: 'barricades.releaseTime', type: 'number', default: 0.25, min: 0, max: 2, step: 0.05, unit: 's', label: 'Time off the edge before contact ends' },
  { key: 'barricades.rehitTime', type: 'number', default: 0.6, min: 0, max: 3, step: 0.05, unit: 's', label: 'Time off the edge before a new hit counts' },
  { key: 'barricades.runepylon.drain', type: 'number', default: 1, min: 0, max: 5, step: 1, unit: 'PV', label: 'Rune pylon: PV drained' },
  { key: 'barricades.runepylon.drainEvery', type: 'number', default: 1.5, min: 0.2, max: 10, step: 0.1, unit: 's', label: 'Rune pylon: drain every (scrape)' },
  { key: 'barricades.scrapeTick', type: 'number', default: 0.5, min: 0.1, max: 3, step: 0.05, unit: 's', label: 'Scrape event interval (damage tick, M3)' },
  ...BARRICADES.flatMap((b) => {
    const d = DEFAULTS[b];
    return [
      { key: `barricades.${b}.scrapeSpeed`, type: 'number' as const, default: d.scrapeSpeed, min: 0.1, max: 1, step: 0.01, label: `${b}: scrape speed (× max)` },
      { key: `barricades.${b}.scrapeDrag`, type: 'number' as const, default: d.scrapeDrag, min: 0, max: 40, step: 0.5, unit: 'm/s²', label: `${b}: scrape drag` },
      { key: `barricades.${b}.hitLoss`, type: 'number' as const, default: d.hitLoss, min: 0, max: 1, step: 0.01, label: `${b}: speed lost on hit` },
      { key: `barricades.${b}.crashScale`, type: 'number' as const, default: d.crashScale, min: 0.3, max: 3, step: 0.05, label: `${b}: crash threshold ×` },
    ];
  }),
]);

export interface BarricadeParams extends BarricadeDefaults {
  type: Barricade;
}

export function barricadeParams(type: Barricade): BarricadeParams {
  const d = DEFAULTS[type];
  return {
    type,
    scrapeSpeed: tunables.get(`barricades.${type}.scrapeSpeed`),
    scrapeDrag: tunables.get(`barricades.${type}.scrapeDrag`),
    hitLoss: tunables.get(`barricades.${type}.hitLoss`),
    crashScale: tunables.get(`barricades.${type}.crashScale`),
    gearLoss: d.gearLoss,
    inset: d.inset,
  };
}

/** Distance of the barricade face from the nominal track edge (also used by the visuals). */
export function barricadeInset(type: Barricade): number {
  return DEFAULTS[type].inset;
}

export type EdgeContactKind = 'none' | 'scrape' | 'hit' | 'crash';

/**
 * Classify a first contact from the velocity relative to the edge.
 * @param vn speed into the edge (m/s, > 0 = towards it)
 * @param vt speed along the edge (m/s)
 */
export function classifyImpact(vn: number, vt: number, p: BarricadeParams): EdgeContactKind {
  if (vn < tunables.get('barricades.hitMinSpeed')) return 'scrape';
  const angle = (Math.atan2(vn, Math.abs(vt)) * 180) / Math.PI;
  if (vn >= tunables.get('barricades.crashSpeed') * p.crashScale && angle >= tunables.get('barricades.crashAngle')) return 'crash';
  return 'hit';
}

/** Speed kept along the edge after a glancing hit. */
export function speedAfterHit(vn: number, vt: number, p: BarricadeParams): number {
  const severity = Math.min(1, vn / (tunables.get('barricades.crashSpeed') * p.crashScale));
  return vt * (1 - p.hitLoss * severity);
}
