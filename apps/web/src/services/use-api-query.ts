import { useCallback, useEffect, useState } from 'react';
import type { z } from 'zod';
import { SessionExpiredError } from './api-client';
import { useApi } from './use-api';

export type QueryState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly error: unknown }
  | { readonly status: 'success'; readonly data: T };

/**
 * Loads `path` from the API and validates it with `schema`, which must be a
 * stable (module-level) value. Results are tagged with the request they
 * answer, so a changed path or a retry shows loading at once and a late
 * response for an old request is never displayed. Leaving the page aborts the
 * request. A SessionExpiredError keeps the loading state: the client has
 * already signed out and the route guard redirects to the login page.
 */
export function useApiQuery<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
): QueryState<z.output<TSchema>> & { retry: () => void } {
  const api = useApi();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    state: QueryState<z.output<TSchema>>;
  } | null>(null);
  const key = `${path}#${attempt}`;

  useEffect(() => {
    const controller = new AbortController();
    api
      .get(path, schema, { signal: controller.signal })
      .then((data) => {
        setResult({ key, state: { status: 'success', data } });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !(error instanceof SessionExpiredError)) {
          setResult({ key, state: { status: 'error', error } });
        }
      });
    return () => {
      controller.abort();
    };
  }, [api, path, schema, key]);

  const retry = useCallback(() => {
    setAttempt((previous) => previous + 1);
  }, []);

  const state = result?.key === key ? result.state : { status: 'loading' as const };
  return { ...state, retry };
}
