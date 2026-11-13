import { describe, expect, it } from 'vitest';
import { steamPips } from '../../src/ui/steam-pips';

const kinds = (r: Parameters<typeof steamPips>[0]) => steamPips(r).map((p) => p.kind);

describe('steam pips (under-vehicle tag + touch ring)', () => {
  it('shows CAL slots, full ones lit when a push is possible', () => {
    expect(kinds({ pv: 3, cal: 5, regen: 0, usable: true })).toEqual(['ready', 'ready', 'ready', 'empty', 'empty']);
  });

  it('greys every full pip while the push is not usable (cooldown)', () => {
    expect(kinds({ pv: 2, cal: 5, regen: 0, usable: false })).toEqual(['grey', 'grey', 'empty', 'empty', 'empty']);
  });

  it('the next empty pip carries the regen progress', () => {
    const pips = steamPips({ pv: 1, cal: 3, regen: 0.4, usable: true });
    expect(pips[1]).toEqual({ kind: 'empty', fill: 0.4 });
    expect(pips[2]!.fill).toBe(0);
  });

  it('PV above CAL add red slots', () => {
    expect(kinds({ pv: 7, cal: 5, regen: 0, usable: true })).toEqual(['ready', 'ready', 'ready', 'ready', 'ready', 'red', 'red']);
  });
});
