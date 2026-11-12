import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core/events';

interface E {
  ping: { n: number };
}

describe('EventBus', () => {
  it('emits immediately and supports unsubscribe', () => {
    const bus = new EventBus<E>();
    const fn = vi.fn();
    const off = bus.on('ping', fn);
    bus.emit('ping', { n: 1 });
    off();
    bus.emit('ping', { n: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ n: 1 });
  });

  it('queues until flush; events queued during flush go to the next flush', () => {
    const bus = new EventBus<E>();
    const got: number[] = [];
    bus.on('ping', ({ n }) => {
      got.push(n);
      if (n === 1) bus.queue('ping', { n: 2 });
    });
    bus.queue('ping', { n: 1 });
    expect(got).toEqual([]);
    bus.flush();
    expect(got).toEqual([1]);
    bus.flush();
    expect(got).toEqual([1, 2]);
  });
});
