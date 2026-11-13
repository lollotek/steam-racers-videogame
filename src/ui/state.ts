import { signal } from '@preact/signals';

/** UI-facing state, written by the game (throttled), read by Preact components. */
export interface PlayerHud {
  index: number;
  gear: number;
  speedKmh: number;
  pushReady: boolean;
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
  standings: signal<{ name: string; color: string; isPlayer: boolean }[]>([]),
};

export function formatTime(t: number | null): string {
  if (t === null || !Number.isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}
