import type { Session } from '@supabase/supabase-js';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AuthProvider } from '../auth/auth-context';
import { createFakeAuthClient, fakeSession } from '../test/fake-auth-client';
import {
  invalidateApiCache,
  invalidateDocumentData,
  setApiCacheUser,
  useApiQuery,
} from './use-api-query';

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

  describe('cache', () => {
    // As in the app, the user is known before any page loads.
    beforeEach(() => {
      setApiCacheUser(fakeSession().user.id);
    });

    async function loadOnce(path: string) {
      const first = renderQuery(path);
      await waitFor(() => {
        expect(first.result.current.status).toBe('success');
      });
      first.unmount();
    }

    it('shows the cached data at once on a revisit, then the fresh response', async () => {
      const second = deferred();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ name: 'first' }))
        .mockReturnValueOnce(second.promise);
      vi.stubGlobal('fetch', fetchMock);
      await loadOnce('/a');

      const { result } = renderQuery('/a');
      expect(result.current).toMatchObject({
        status: 'success',
        data: { name: 'first' },
        refreshing: true,
      });

      await act(async () => {
        second.resolve(Response.json({ name: 'second' }));
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(result.current).toMatchObject({ data: { name: 'second' }, refreshing: false });
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('keeps the cached data when the background refetch fails', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ name: 'first' }))
        .mockResolvedValueOnce(Response.json({}, { status: 500 }));
      vi.stubGlobal('fetch', fetchMock);
      await loadOnce('/a');

      const { result } = renderQuery('/a');
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });
      await act(async () => {
        await new Promise((settle) => setTimeout(settle, 20));
      });
      expect(result.current).toMatchObject({
        status: 'success',
        data: { name: 'first' },
        refreshing: false,
      });
    });

    it('loads afresh after its path is invalidated', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(Response.json({ name: 'first' }))),
      );
      await loadOnce('/documents?limit=5');

      invalidateDocumentData();
      expect(renderQuery('/documents?limit=5').result.current.status).toBe('loading');
    });

    it('keeps paths the invalidation does not cover', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(Response.json({ name: 'first' }))),
      );
      await loadOnce('/me');

      invalidateDocumentData();
      expect(renderQuery('/me').result.current.status).toBe('success');
    });

    it('refreshes a mounted query in the background when its path is invalidated', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ name: 'before' }))
        .mockResolvedValueOnce(Response.json({ name: 'after' }));
      vi.stubGlobal('fetch', fetchMock);
      const { result } = renderQuery('/documents?status=needs_review');
      await waitFor(() => {
        expect(result.current.status).toBe('success');
      });

      act(() => {
        invalidateApiCache('/documents');
      });
      // The old data stays on screen while the new request runs.
      expect(result.current).toMatchObject({ data: { name: 'before' }, refreshing: true });
      await waitFor(() => {
        expect(result.current).toMatchObject({ data: { name: 'after' }, refreshing: false });
      });
    });

    it('forgets everything when cleared, as on a change of user', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(Response.json({ name: 'first' }))),
      );
      await loadOnce('/me');

      invalidateApiCache();
      expect(renderQuery('/me').result.current.status).toBe('loading');
    });

    it('never caches a response requested before an invalidation', async () => {
      const late = deferred();
      vi.stubGlobal(
        'fetch',
        vi.fn(() => late.promise),
      );
      const first = renderQuery('/me');
      invalidateApiCache();
      await act(async () => {
        late.resolve(Response.json({ name: 'previous user' }));
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(first.result.current.status).toBe('success');
      });
      first.unmount();

      expect(renderQuery('/me').result.current.status).toBe('loading');
    });
  });
});
