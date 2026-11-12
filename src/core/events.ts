/**
 * Typed event bus (doc 03 §5.1, §5.3).
 * `emit` delivers immediately; `queue` + `flush` defers delivery (used by the simulation
 * so listeners run after a step, never in the middle of it).
 */
import type { QualityTierName } from '../render/quality';

export interface GameEvents {
  qualityTierChanged: { tier: QualityTierName; renderScale: number };
  gearChanged: { racer: number; gear: number };
  pauseChanged: { paused: boolean };
}

type Handler<T> = (payload: T) => void;

export class EventBus<E extends object = GameEvents> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();
  private pending: { type: keyof E; payload: unknown }[] = [];

  on<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    return () => set.delete(handler as Handler<never>);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of set) (h as Handler<E[K]>)(payload);
  }

  queue<K extends keyof E>(type: K, payload: E[K]): void {
    this.pending.push({ type, payload });
  }

  flush(): void {
    // Swap first so handlers that queue new events are delivered on the next flush.
    const batch = this.pending;
    this.pending = [];
    for (const ev of batch) this.emit(ev.type, ev.payload as E[typeof ev.type]);
  }

  clear(): void {
    this.handlers.clear();
    this.pending = [];
  }
}
