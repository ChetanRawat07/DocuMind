import { useCallback, useEffect, useState } from 'react';
import type { z } from 'zod';
import { type ApiClient, SessionExpiredError } from './api-client';
import { useApi } from './use-api';

export type QueryState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | { readonly status: 'success'; readonly data: T };

interface CacheEntry {
  readonly data: unknown;
  readonly fetchedAt: number;
}

/**
 * The last response for each API path, oldest first, so a page shows at once
 * when revisited. It holds one user's data (see setApiCacheUser). A path
 * always has the same schema, so an entry is the type its path's query expects.
 */
const cache = new Map<string, CacheEntry>();
let cacheUser: string | undefined;
const CACHE_LIMIT = 50;
/** A prefetch skips paths fetched more recently than this. */
const PREFETCH_FRESH_MS = 30_000;
/** Bumped by every invalidation, so a response requested before one is never cached after it. */
let generation = 0;
const prefetching = new Set<string>();
/** Mounted queries, told which paths changed so they refresh in the background. */
const listeners = new Set<(prefix: string) => void>();

function remember(path: string, data: unknown): void {
  cache.delete(path);
  cache.set(path, { data, fetchedAt: Date.now() });
  for (const oldest of cache.keys()) {
    if (cache.size <= CACHE_LIMIT) break;
    cache.delete(oldest);
  }
}

/**
 * Forgets cached responses whose path starts with `prefix`, after a change
 * on the server, and refreshes the queries showing them. Without a prefix it
 * forgets everything and refreshes nothing: that is for a change of user.
 */
export function invalidateApiCache(prefix?: string): void {
  generation += 1;
  if (prefix === undefined) {
    cache.clear();
    return;
  }
  for (const path of cache.keys()) {
    if (path.startsWith(prefix)) cache.delete(path);
  }
  for (const listener of listeners) listener(prefix);
}

/** Records who is signed in; a different user (or none) clears the cache, so one user's data never shows for another. */
export function setApiCacheUser(userId: string | undefined): void {
  if (userId === cacheUser) return;
  cacheUser = userId;
  invalidateApiCache();
}

/** After a document changes: its lists and pages, analytics, processing jobs and the audit log. */
export function invalidateDocumentData(): void {
  for (const prefix of ['/documents', '/analytics', '/processing', '/audit-logs']) {
    invalidateApiCache(prefix);
  }
}

/** Loads `path` into the cache ahead of its page, unless a recent response is there. */
export function prefetchApiQuery(api: ApiClient, path: string, schema: z.ZodType): void {
  const cached = cache.get(path);
  if (prefetching.has(path) || (cached && Date.now() - cached.fetchedAt < PREFETCH_FRESH_MS)) {
    return;
  }
  prefetching.add(path);
  const started = generation;
  api
    .get(path, schema)
    .then(
      (data) => {
        if (started === generation) remember(path, data);
      },
      // The page loads it again and reports any failure.
      () => undefined,
    )
    .finally(() => {
      prefetching.delete(path);
    });
}

/**
 * Loads `path` from the API and validates it with `schema`, which must be a
 * stable (module-level) value. A path loaded before shows its cached data at
 * once (stale-while-revalidate) while it is fetched again; `refreshing` is
 * true until the new response replaces it. A failed refresh keeps the data
 * on screen. Results are tagged with the request they answer, so a changed
 * path or a retry never shows a late response for an old request. Leaving the
 * page aborts the request. A SessionExpiredError keeps the current state:
 * the client has already signed out and the route guard redirects to the
 * login page.
 */
export function useApiQuery<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
): QueryState<z.output<TSchema>> & { refreshing: boolean; retry: () => void } {
  const api = useApi();
  const [attempt, setAttempt] = useState(0);
  // Bumped when the path is invalidated: refetches without leaving the current data.
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    revision: number;
    state: QueryState<z.output<TSchema>>;
  } | null>(null);
  const key = `${path}#${attempt}`;

  useEffect(() => {
    const listener = (prefix: string) => {
      if (path.startsWith(prefix)) {
        setRevision((previous) => previous + 1);
      }
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [path]);

  useEffect(() => {
    const controller = new AbortController();
    const started = generation;
    api
      .get(path, schema, { signal: controller.signal })
      .then((data) => {
        if (started === generation) remember(path, data);
        setResult({ key, revision, state: { status: 'success', data } });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || error instanceof SessionExpiredError) return;
        setResult((previous) =>
          previous?.key === key && previous.state.status === 'success'
            ? { ...previous, revision }
            : { key, revision, state: { status: 'error', error } },
        );
      });
    return () => {
      controller.abort();
    };
  }, [api, path, schema, key, revision]);

  const retry = useCallback(() => {
    setAttempt((previous) => previous + 1);
  }, []);

  const current = result?.key === key ? result : null;
  const cached = cache.get(path);
  if (current && !(current.state.status === 'error' && cached)) {
    return { ...current.state, refreshing: current.revision !== revision, retry };
  }
  if (cached) {
    const data = cached.data as z.output<TSchema>;
    return { status: 'success', data, refreshing: current === null, retry };
  }
  return { status: 'loading', refreshing: false, retry };
}
