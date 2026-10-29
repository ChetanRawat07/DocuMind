import { apiErrorResponseSchema } from '@documind/shared';
import type { z } from 'zod';
import type { AuthClient } from '../auth/auth-client';

export const API_BASE_PATH = '/api/v1';

/** A non-2xx API response, carrying the shared error envelope's code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The session is gone (expired, revoked or signed out); the user must sign in again. */
export class SessionExpiredError extends Error {
  constructor() {
    super('Your session has ended. Please sign in again.');
    this.name = 'SessionExpiredError';
  }
}

export interface ApiClient {
  get<TSchema extends z.ZodType>(
    path: string,
    schema: TSchema,
    options?: { signal?: AbortSignal },
  ): Promise<z.output<TSchema>>;
}

/**
 * Calls the API with the current access token. On a 401 it refreshes the
 * session once and retries, which covers a token that expired in flight. If
 * that fails too, it signs out locally, and the route guard sends the user
 * to the login page. Responses are validated against the shared contracts.
 */
export function createApiClient(auth: AuthClient): ApiClient {
  async function send(path: string, token: string, signal?: AbortSignal): Promise<Response> {
    return fetch(`${API_BASE_PATH}${path}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      ...(signal ? { signal } : {}),
    });
  }

  async function endSession(): Promise<never> {
    await auth.signOut({ scope: 'local' });
    throw new SessionExpiredError();
  }

  return {
    async get(path, schema, options = {}) {
      const { data } = await auth.getSession();
      if (!data.session) {
        return endSession();
      }

      let response = await send(path, data.session.access_token, options.signal);
      if (response.status === 401) {
        const refreshed = await auth.refreshSession();
        if (!refreshed.data.session) {
          return endSession();
        }
        response = await send(path, refreshed.data.session.access_token, options.signal);
        if (response.status === 401) {
          return endSession();
        }
      }

      if (!response.ok) {
        throw await toApiError(response);
      }
      return schema.parse(await response.json());
    },
  };
}

async function toApiError(response: Response): Promise<ApiError> {
  const body = apiErrorResponseSchema.safeParse(await response.json().catch(() => null));
  return body.success
    ? new ApiError(response.status, body.data.error.code, body.data.error.message)
    : new ApiError(response.status, 'HTTP_ERROR', `Request failed with HTTP ${response.status}`);
}
