import type { CurrentUser, DocumentDto } from '@documind/shared';
import type { Session } from '@supabase/supabase-js';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { App } from '../App';
import { AuthProvider } from '../auth/auth-context';
import { createFakeAuthClient } from './fake-auth-client';

export const TEST_USER: CurrentUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'ada@example.test',
  displayName: 'Ada',
  createdAt: '2026-10-29T10:00:00.000Z',
};

export function testDocument(overrides: Partial<DocumentDto> = {}): DocumentDto {
  return {
    id: '00000000-0000-4000-8000-0000000000d1',
    originalFilename: 'invoice-1023.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    documentType: 'invoice',
    status: 'completed',
    processedAt: '2026-10-29T10:01:00.000Z',
    createdAt: '2026-10-29T10:00:00.000Z',
    updatedAt: '2026-10-29T10:01:00.000Z',
    ...overrides,
  };
}

/**
 * Stubs fetch with the API's signed-in responses: GET /me returns TEST_USER
 * and the document list is empty. `handle` answers a URL first; return
 * undefined to fall through to the defaults. Returns the fetch mock.
 */
export function stubApi(
  handle: (url: string) => Response | Promise<Response> | undefined = () => undefined,
) {
  const fetchMock = vi.fn((url: string) => {
    const custom = handle(url);
    if (custom) return Promise.resolve(custom);
    if (url === '/api/v1/me') return Promise.resolve(Response.json(TEST_USER));
    if (url.startsWith('/api/v1/documents')) {
      return Promise.resolve(Response.json({ items: [], nextCursor: null }));
    }
    return Promise.resolve(Response.json({ status: 'ok', timestamp: '2026-10-29T10:00:00.000Z' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Renders the whole app at `path` with a fake Supabase client holding `session`. */
export function renderApp(path: string, session: Session | null = null, state?: unknown) {
  const fake = createFakeAuthClient(session);
  render(
    <AuthProvider client={fake.client}>
      <MemoryRouter initialEntries={[{ pathname: path, state }]}>
        <App />
      </MemoryRouter>
    </AuthProvider>,
  );
  return fake;
}

/** An API error in the shared envelope. */
export function apiErrorResponse(status: number): Response {
  return Response.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
    { status },
  );
}
