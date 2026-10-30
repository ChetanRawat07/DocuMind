import { apiErrorResponseSchema, UPLOAD_FIELD_NAME } from '@documind/shared';
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

export interface UploadOptions {
  readonly signal?: AbortSignal;
  /** Fraction of the request body sent so far, from 0 to 1. */
  readonly onProgress?: (fraction: number) => void;
}

export interface ApiClient {
  get<TSchema extends z.ZodType>(
    path: string,
    schema: TSchema,
    options?: { signal?: AbortSignal },
  ): Promise<z.output<TSchema>>;
  /** Sends `file` as multipart form data and validates the response. */
  upload<TSchema extends z.ZodType>(
    path: string,
    file: File,
    schema: TSchema,
    options?: UploadOptions,
  ): Promise<z.output<TSchema>>;
  delete(path: string): Promise<void>;
}

/** The part of a response the client needs, from either fetch or XMLHttpRequest. */
interface RawResponse {
  readonly status: number;
  json(): Promise<unknown>;
}

const isOk = (status: number) => status >= 200 && status < 300;

/**
 * Calls the API with the current access token. On a 401 it refreshes the
 * session once and retries, which covers a token that expired in flight. If
 * that fails too, it signs out locally, and the route guard sends the user
 * to the login page. Responses are validated against the shared contracts.
 */
export function createApiClient(auth: AuthClient): ApiClient {
  async function endSession(): Promise<never> {
    await auth.signOut({ scope: 'local' });
    throw new SessionExpiredError();
  }

  async function withSession(
    perform: (token: string) => Promise<RawResponse>,
  ): Promise<RawResponse> {
    const { data } = await auth.getSession();
    if (!data.session) {
      return endSession();
    }

    let response = await perform(data.session.access_token);
    if (response.status === 401) {
      const refreshed = await auth.refreshSession();
      if (!refreshed.data.session) {
        return endSession();
      }
      response = await perform(refreshed.data.session.access_token);
      if (response.status === 401) {
        return endSession();
      }
    }
    if (!isOk(response.status)) {
      throw await toApiError(response);
    }
    return response;
  }

  return {
    async get(path, schema, options = {}) {
      const response = await withSession((token) =>
        fetch(`${API_BASE_PATH}${path}`, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
          ...(options.signal ? { signal: options.signal } : {}),
        }),
      );
      return schema.parse(await response.json());
    },

    async upload(path, file, schema, options = {}) {
      const response = await withSession((token) => {
        const body = new FormData();
        body.append(UPLOAD_FIELD_NAME, file, file.name);
        return sendWithProgress(`${API_BASE_PATH}${path}`, token, body, options);
      });
      return schema.parse(await response.json());
    },

    async delete(path) {
      await withSession((token) =>
        fetch(`${API_BASE_PATH}${path}`, {
          method: 'DELETE',
          headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        }),
      );
    },
  };
}

/**
 * POST with upload progress. fetch cannot report request-body progress, so
 * this uses XMLHttpRequest. The browser sets the multipart Content-Type with
 * its boundary. Aborting rejects with an AbortError, like fetch.
 */
function sendWithProgress(
  url: string,
  token: string,
  body: FormData,
  { signal, onProgress }: UploadOptions,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The upload was cancelled.', 'AbortError'));
      return;
    }
    const xhr = new XMLHttpRequest();
    const abort = () => {
      xhr.abort();
    };

    xhr.open('POST', url);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      signal?.removeEventListener('abort', abort);
      const text = xhr.responseText;
      resolve({
        status: xhr.status,
        json: () => Promise.resolve(JSON.parse(text) as unknown),
      });
    };
    xhr.onerror = () => {
      signal?.removeEventListener('abort', abort);
      reject(new TypeError('Network request failed'));
    };
    xhr.onabort = () => {
      reject(new DOMException('The upload was cancelled.', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    xhr.send(body);
  });
}

async function toApiError(response: RawResponse): Promise<ApiError> {
  const body = apiErrorResponseSchema.safeParse(await response.json().catch(() => null));
  return body.success
    ? new ApiError(response.status, body.data.error.code, body.data.error.message)
    : new ApiError(response.status, 'HTTP_ERROR', `Request failed with HTTP ${response.status}`);
}

/** True for the error a cancelled request rejects with. */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
