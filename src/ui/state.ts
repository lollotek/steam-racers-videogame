import { signal } from '@preact/signals';

/** UI-facing state, written by the game (throttled), read by Preact components. */
export interface PlayerHud {
  index: number;
  gear: number;
  speedKmh: number;
  pushReady: boolean;
  device: string;
  identityColor: string;
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
};
