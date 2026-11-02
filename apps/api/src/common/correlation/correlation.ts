import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Ids that tie together everything one piece of work causes: the request
 * that started it, and the job that carries it into the worker. Logged on
 * every line and stored on audit entries and jobs (docs/operations/observability.md).
 */
export interface Correlation {
  readonly requestId?: string;
  readonly jobId?: string;
}

const storage = new AsyncLocalStorage<Correlation>();

/** Runs `work` with `correlation` added to the current ids, for everything it awaits or calls. */
export function withCorrelation<T>(correlation: Correlation, work: () => T): T {
  return storage.run({ ...storage.getStore(), ...correlation }, work);
}

/** The ids of the work in progress; empty outside a request or job. */
export function currentCorrelation(): Correlation {
  return storage.getStore() ?? {};
}
