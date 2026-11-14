/**
 * URL flags (doc 03 §15.3). Parsed once at boot.
 *   ?debug            tuning panel + stats
 *   ?tier=low|medium|high|ultra
 *   ?backend=webgl2   force the WebGL2 fallback
 *   ?seed=123
 *   ?racers=4         4..8
 *   ?players=2        split screen (PC only)
 *   ?touch=1          force touch controls (0 = hide)
 *   ?laps=1           override the track lap count (1..9)
 *   ?track=id         track file from src/tracks (default foundry-01)
 *   ?test             expose test hooks on window
 *   ?fullscreen=0     phones: do not enter fullscreen on the first tap
 *   ?quick            skip the menus: straight into a race from these flags (implied by ?test;
 *                     ?test&menu=1 keeps the menus)
 */
import type { QualityTierName } from '../render/quality';

export interface Flags {
  debug: boolean;
  tier: QualityTierName | null;
  forceWebGL: boolean;
  seed: number;
  racers: number;
  players: 1 | 2;
  touch: boolean | null;
  test: boolean;
  laps: number | null;
  track: string | null;
  fullscreen: boolean;
  /** Boot straight into a race (no title / setup screens). */
  quick: boolean;
}

const TIERS: readonly QualityTierName[] = ['low', 'medium', 'high', 'ultra'];

export function parseFlags(search: string): Flags {
  const p = new URLSearchParams(search);
  const num = (k: string, d: number) => {
    const v = Number(p.get(k));
    return p.has(k) && Number.isFinite(v) ? v : d;
  };
  const tier = p.get('tier') as QualityTierName | null;
  const touch = p.get('touch');
  return {
    debug: p.has('debug') && p.get('debug') !== '0',
    tier: tier && TIERS.includes(tier) ? tier : null,
    forceWebGL: p.get('backend') === 'webgl2' || p.get('backend') === 'webgl',
    seed: Math.floor(num('seed', 1)) >>> 0,
    racers: Math.min(8, Math.max(1, Math.floor(num('racers', 4)))),
    players: num('players', 1) >= 2 ? 2 : 1,
    touch: touch === null ? null : touch !== '0',
    test: p.has('test'),
    laps: p.has('laps') ? Math.min(9, Math.max(1, Math.floor(num('laps', 3)))) : null,
    track: p.get('track') && /^[a-z0-9-]+$/.test(p.get('track')!) ? p.get('track') : null,
    fullscreen: p.get('fullscreen') !== '0',
    quick: (p.has('quick') && p.get('quick') !== '0') || (p.has('test') && p.get('menu') !== '1'),
  };
}
