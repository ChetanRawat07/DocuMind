import type { Session } from '@supabase/supabase-js';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AuthProvider } from '../auth/auth-context';
import { createFakeAuthClient, fakeSession } from '../test/fake-auth-client';
import { useApiQuery } from './use-api-query';

const itemSchema = z.object({ name: z.string() });

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function renderQuery(initialPath: string, session: Session | null = fakeSession()) {
  const fake = createFakeAuthClient(session);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider client={fake.client}>{children}</AuthProvider>
  );
  return renderHook(({ path }: { path: string }) => useApiQuery(path, itemSchema), {
    wrapper,
    initialProps: { path: initialPath },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useApiQuery', () => {
  it('shows loading for a new path at once and never shows a late response for the old one', async () => {
    const responses = { '/api/v1/a': deferred(), '/api/v1/b': deferred() };
    vi.stubGlobal(
      'fetch',
      vi.fn((url: keyof typeof responses) => responses[url].promise),
    );
    const { result, rerender } = renderQuery('/a');
    expect(result.current.status).toBe('loading');

    rerender({ path: '/b' });
    expect(result.current.status).toBe('loading');

    await act(async () => {
      responses['/api/v1/a'].resolve(Response.json({ name: 'stale a' }));
      await Promise.resolve();
    });
    expect(result.current.status).toBe('loading');

    await act(async () => {
      responses['/api/v1/b'].resolve(Response.json({ name: 'fresh b' }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current).toMatchObject({ status: 'success', data: { name: 'fresh b' } });
    });
  });

  it('reports a response that does not match the schema as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ unexpected: true }))),
    );
    const { result } = renderQuery('/a');

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
  });

  it('shows loading again on retry, then the new result', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}, { status: 500 }))
      .mockResolvedValueOnce(Response.json({ name: 'second try' }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderQuery('/a');
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });

    act(() => {
      result.current.retry();
    });
    expect(result.current.status).toBe('loading');

    await waitFor(() => {
      expect(result.current).toMatchObject({ status: 'success', data: { name: 'second try' } });
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stays loading instead of erroring when the session has ended', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderQuery('/a', null);

    await act(async () => {
      await new Promise((settle) => setTimeout(settle, 20));
    });
    expect(result.current.status).toBe('loading');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
