/**
 * Tabletop characteristics per vehicle (gameplay.md §3.1): CAL, AFF, RES, MAN, PF.
 * Driving characteristics live in VehicleSpec / `handling.*`; these feed the rules layer.
 * Values are placeholders until the owner confirms them (doc 03 §19, A7); all are live-tunable.
 */
import { tunables } from '../core/tunables';

export interface VehicleStats {
  /** Boiler capacity: PV held before the red zone. */
  cal: number;
  /** Reliability: slower pressure, wider test notch, more start tolerance. */
  aff: number;
  /** Resistance: subtracted from the damage of every hit. */
  res: number;
  /** Manoeuvrability: widens the start test band. */
  man: number;
  /** Hull points. */
  pf: number;
  /** Ramming inertia factor (mass class). */
  mass: number;
}

export type StatsId = 'hotrod' | 'tank';

const DEFAULTS: Record<StatsId, VehicleStats> = {
  hotrod: { cal: 5, aff: 2, res: 0, man: 3, pf: 20, mass: 1 },
  tank: { cal: 6, aff: 3, res: 1, man: 1, pf: 20, mass: 1.5 },
};

tunables.registerGroup(
  'stats',
  (Object.keys(DEFAULTS) as StatsId[]).flatMap((id) => {
    const d = DEFAULTS[id];
    return [
      { key: `stats.${id}.cal`, type: 'number' as const, default: d.cal, min: 1, max: 12, step: 1, unit: 'PV', label: `${id}: CAL` },
      { key: `stats.${id}.aff`, type: 'number' as const, default: d.aff, min: 0, max: 6, step: 1, label: `${id}: AFF` },
      { key: `stats.${id}.res`, type: 'number' as const, default: d.res, min: 0, max: 5, step: 1, label: `${id}: RES` },
      { key: `stats.${id}.man`, type: 'number' as const, default: d.man, min: 0, max: 6, step: 1, label: `${id}: MAN` },
      { key: `stats.${id}.pf`, type: 'number' as const, default: d.pf, min: 1, max: 60, step: 1, unit: 'PF', label: `${id}: PF` },
      { key: `stats.${id}.mass`, type: 'number' as const, default: d.mass, min: 0.3, max: 4, step: 0.1, label: `${id}: ramming mass` },
    ];
  }),
);

export function vehicleStats(id: StatsId): VehicleStats {
  const g = (k: keyof VehicleStats) => tunables.get<number>(`stats.${id}.${k}`);
  return { cal: g('cal'), aff: g('aff'), res: g('res'), man: g('man'), pf: g('pf'), mass: g('mass') };
}
