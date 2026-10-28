import { describe, expect, it, vi } from 'vitest';
import { PollingLoop } from './polling-loop.js';

const LONG_IDLE_DELAY_MS = 60_000;

/** Resolves once `predicate` holds, polling the microtask/timer queue briefly. */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Condition not met in time');
}

describe('PollingLoop', () => {
  it('polls again immediately while work is found, then idles', async () => {
    const results = [true, true, false];
    const tick = vi.fn(() => Promise.resolve(results.shift() ?? false));
    const loop = new PollingLoop({ tick, idleDelayMs: LONG_IDLE_DELAY_MS, onError: vi.fn() });

    loop.start();
    await waitFor(() => tick.mock.calls.length === 3);
    await loop.stop();

    expect(tick).toHaveBeenCalledTimes(3);
  });

  it('stops promptly while idle instead of waiting out the delay', async () => {
    const tick = vi.fn(() => Promise.resolve(false));
    const loop = new PollingLoop({ tick, idleDelayMs: LONG_IDLE_DELAY_MS, onError: vi.fn() });

    loop.start();
    await waitFor(() => tick.mock.calls.length === 1);

    const startedAt = Date.now();
    await loop.stop();

    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('lets an in-flight tick finish before stop resolves', async () => {
    let finishTick: (foundWork: boolean) => void = () => undefined;
    let tickFinished = false;
    const tick = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishTick = (foundWork) => {
            tickFinished = true;
            resolve(foundWork);
          };
        }),
    );
    const loop = new PollingLoop({ tick, idleDelayMs: LONG_IDLE_DELAY_MS, onError: vi.fn() });

    loop.start();
    await waitFor(() => tick.mock.calls.length === 1);

    const stopped = loop.stop();
    finishTick(true);
    await stopped;

    expect(tickFinished).toBe(true);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('reports tick errors and keeps polling', async () => {
    const failure = new Error('transient failure');
    const tick = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(false);
    const onError = vi.fn();
    const loop = new PollingLoop({ tick, idleDelayMs: 10, onError });

    loop.start();
    await waitFor(() => tick.mock.calls.length >= 2);
    await loop.stop();

    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('refuses to start twice', async () => {
    const loop = new PollingLoop({
      tick: () => Promise.resolve(false),
      idleDelayMs: LONG_IDLE_DELAY_MS,
      onError: vi.fn(),
    });

    loop.start();
    expect(() => {
      loop.start();
    }).toThrow('already running');
    await loop.stop();
  });

  it('can be stopped without having been started', async () => {
    const loop = new PollingLoop({
      tick: () => Promise.resolve(false),
      idleDelayMs: LONG_IDLE_DELAY_MS,
      onError: vi.fn(),
    });

    await expect(loop.stop()).resolves.toBeUndefined();
  });
});
