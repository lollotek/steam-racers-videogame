import { signal } from '@preact/signals';
import type { SteamReadout } from './steam-pips';

export interface Banner {
  id: number;
  text: string;
  tone: 'good' | 'bad' | 'warn' | 'dmg' | 'info';
  /** performance.now() when it disappears. */
  until: number;
}

/** UI-facing state, written by the game (throttled), read by Preact components. */
export interface PlayerHud {
  /** Hull points (gameplay.md §6.1). */
  pf: number;
  pfMax: number;
  condition: 'ok' | 'smoke' | 'fire' | 'wreck';
  /** Front cannon shells and readiness. */
  ammo: number;
  cannonReady: boolean;
  /** Weapons unlock after `unlockLap` laps (clean first lap). */
  armed: boolean;
  unlockLap: number;
  /** Boiler gauge: 0 → 2 × CAL, right half red (gameplay.md §5.2). */
  boiler: { pv: number; cal: number; pressure: number; test: boolean };
  banners: Banner[];
  index: number;
  gear: number;
  speedKmh: number;
  pushReady: boolean;
  steam: SteamReadout;
  device: string;
  identityColor: string;
  lap: number;
  laps: number;
  position: number;
  racers: number;
  lapTime: number;
  bestLap: number | null;
  lastLap: number | null;
  wrongWay: boolean;
  finished: boolean;
}

export interface ResultRow {
  name: string;
  color: string;
  time: number | null;
  bestLap: number | null;
  isPlayer: boolean;
  /** Wrecked before the finish. */
  retired: boolean;
  pf: number;
}

export const ui = {
  backend: signal<string>('…'),
  tier: signal<string>('…'),
  renderScale: signal<number>(1),
  fps: signal<number>(0),
  players: signal<PlayerHud[]>([]),
  paused: signal<boolean>(false),
  showTouch: signal<boolean>(false),
  splitScreen: signal<boolean>(false),
  error: signal<string | null>(null),
  /** True until shaders are compiled and the first frame is ready. */
  loading: signal<boolean>(true),
  /** Race phase and countdown (seconds left, 0 when running). */
  phase: signal<'countdown' | 'running' | 'finished'>('countdown'),
  countdown: signal<number>(0),
  /** Shown when every player has finished. */
  results: signal<ResultRow[] | null>(null),
  /** Standings for the mini leaderboard: name + color, in order. */
  standings: signal<{ name: string; color: string; isPlayer: boolean; retired: boolean }[]>([]),
};

export function formatTime(t: number | null): string {
  if (t === null || !Number.isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}
