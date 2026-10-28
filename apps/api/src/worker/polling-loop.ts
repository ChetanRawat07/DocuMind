import { setTimeout as sleep } from 'node:timers/promises';

export interface PollingLoopOptions {
  /** Performs one unit of work. Resolves `true` when work was found, so the loop polls again immediately. */
  readonly tick: () => Promise<boolean>;
  /** How long to wait after an empty or failed poll before trying again. */
  readonly idleDelayMs: number;
  readonly onError: (error: unknown) => void;
}

/**
 * Sequential poll loop for the worker process.
 *
 * - Never overlaps ticks, so one loop processes one unit of work at a time.
 * - Backs off after an empty poll or an error instead of spinning on the database.
 * - `stop()` interrupts the idle wait immediately but lets an in-flight tick finish,
 *   which is what graceful shutdown on SIGTERM needs.
 */
export class PollingLoop {
  private abortController: AbortController | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly options: PollingLoopOptions) {}

  start(): void {
    if (this.running) {
      throw new Error('PollingLoop is already running');
    }
    const controller = new AbortController();
    this.abortController = controller;
    this.running = this.run(controller.signal);
  }

  async stop(): Promise<void> {
    this.abortController?.abort();
    await this.running;
    this.abortController = null;
    this.running = null;
  }

  private async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      let foundWork = false;
      try {
        foundWork = await this.options.tick();
      } catch (error) {
        this.options.onError(error);
      }

      if (!foundWork) {
        await sleep(this.options.idleDelayMs, undefined, { signal }).catch(() => undefined);
      }
    }
  }
}
