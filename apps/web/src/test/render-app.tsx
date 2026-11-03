import type { Analytics, CurrentUser, DocumentDto } from '@documind/shared';
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

/** Analytics of a user with nothing processed in the window; overrides add the data a test needs. */
export function testAnalytics(overrides: Partial<Analytics> = {}): Analytics {
  return {
    days: 30,
    timezone: 'UTC',
    since: '2026-09-30',
    documents: { uploaded: 0, processed: 0, succeeded: 0, failed: 0, needsReview: 0 },
    successRate: null,
    failureRate: null,
    processingMs: { average: null, p95: null },
    documentTypes: [],
    confidence: [
      { bucket: 'below_50', count: 0 },
      { bucket: '50_to_70', count: 0 },
      { bucket: '70_to_90', count: 0 },
      { bucket: '90_and_above', count: 0 },
    ],
    review: {
      extracted: 0,
      autoCompleted: 0,
      approvedAfterReview: 0,
      rejected: 0,
      pending: 0,
      rate: null,
    },
    corrections: { reviewedFields: 0, correctedFields: 0, rate: null },
    volume: Array.from({ length: 30 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 8, 30 + index)).toISOString().slice(0, 10),
      processed: 0,
      failed: 0,
    })),
    ...overrides,
  };
}

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
  handle: (url: string, init?: RequestInit) => Response | Promise<Response> | undefined = () =>
    undefined,
) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const custom = handle(url, init);
    if (custom) return Promise.resolve(custom);
    if (url === '/api/v1/me') return Promise.resolve(Response.json(TEST_USER));
    if (url.startsWith('/api/v1/analytics')) return Promise.resolve(Response.json(testAnalytics()));
    // A document that has not been processed has no extraction, as in the API.
    if (url.endsWith('/extraction')) return Promise.resolve(apiErrorResponse(404));
    if (url.endsWith('/activity')) return Promise.resolve(Response.json({ items: [] }));
    if (url.startsWith('/api/v1/documents')) {
      return Promise.resolve(Response.json({ items: [], nextCursor: null }));
    }
    return Promise.resolve(Response.json({ status: 'ok', timestamp: '2026-10-29T10:00:00.000Z' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Renders the whole app at `path` (which may carry a query string) with a fake Supabase client holding `session`. */
export function renderApp(path: string, session: Session | null = null, state?: unknown) {
  const fake = createFakeAuthClient(session);
  const { pathname, search, hash } = new URL(path, 'http://localhost');
  render(
    <AuthProvider client={fake.client}>
      <MemoryRouter initialEntries={[{ pathname, search, hash, state }]}>
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
