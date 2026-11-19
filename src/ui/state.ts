import { signal } from '@preact/signals';
import type { SteamReadout } from './steam-pips';
import type { Difficulty, Season, UpgradeLine, VehicleId } from '../cup/cup';

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
  /** Weapons armed once the boiler warmed up; `unlock` says how (e.g. "6th gear or lap 2", `unlockShort` "gear 6 / lap 2"). */
  armed: boolean;
  unlock: string;
  unlockShort: string;
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
  /** Cup money collected on the track this race (money bags, doc 04 A3). */
  money: number;
}

export interface ResultRow {
  /** Racer index in the race. */
  index: number;
  name: string;
  color: string;
  time: number | null;
  bestLap: number | null;
  isPlayer: boolean;
  /** Wrecked before the finish. */
  retired: boolean;
  pf: number;
  /** Money bags collected ($). */
  bags: number;
  /** Cup only: prize and repair of this race (live while the AI still race). */
  prize?: number;
  repair?: number;
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

// --- Front-end flow (doc 04 B1/B2) --------------------------------------------------------------

/** Which full screen is up. `race` = the HUD (results and pause are overlays on top of it). */
export type Screen = 'title' | 'briefing' | 'race' | 'standings' | 'workshop' | 'trophy';

export const flowUi = {
  screen: signal<Screen>('race'),
  mode: signal<'quick' | 'single' | 'cup'>('quick'),
  /** The running Cup (a fresh copy after every change, so components re-render). */
  season: signal<Season | null>(null),
  /** A saved Cup to continue from the title. */
  saved: signal<Season | null>(null),
  /** Workshop: whose turn (index of the human player, 2-player Cup). */
  workshopPlayer: signal<number>(0),
  /** Split screen allowed (PC). */
  canSplit: signal<boolean>(true),
};

export interface SetupChoice {
  players: 1 | 2;
  difficulty: Difficulty;
  vehicles: VehicleId[];
  /** Single race only. */
  trackId?: string;
}

/** What the screens can ask the flow to do (implemented by src/flow/flow.ts). */
export interface FlowActions {
  tracks: { id: string; name: string }[];
  newCup(c: SetupChoice): void;
  continueCup(): void;
  startSingle(c: SetupChoice): void;
  /** Briefing → race. */
  startRound(): void;
  /** Cup results → standings. */
  resultsContinue(): void;
  /** Standings → workshop / trophy. */
  standingsContinue(): void;
  buy(racer: number, line: UpgradeLine): void;
  /** Workshop → next player / next briefing. */
  workshopDone(): void;
  raceAgain(): void;
  resume(): void;
  restart(): void;
  retire(): void;
  toTitle(): void;
}
