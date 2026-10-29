import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { vi } from 'vitest';
import type { AuthClient } from '../auth/auth-client';

export function fakeSession(accessToken = 'access-token-1'): Session {
  return {
    access_token: accessToken,
    refresh_token: 'refresh-token',
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id: '00000000-0000-4000-8000-000000000001',
      email: 'ada@example.test',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2026-10-29T10:00:00.000Z',
    },
  };
}

type Listener = (event: AuthChangeEvent, session: Session | null) => void;

/**
 * In-memory stand-in for supabase-js auth. Like the real client, it reports
 * the stored session asynchronously as INITIAL_SESSION after subscribing,
 * and a sign-out notifies subscribers.
 */
export function createFakeAuthClient(initialSession: Session | null = null) {
  let session = initialSession;
  const listeners = new Set<Listener>();

  const emit = (event: AuthChangeEvent, next: Session | null) => {
    session = next;
    for (const listener of listeners) listener(event, next);
  };

  const mocks = {
    onAuthStateChange: vi.fn((listener: Listener) => {
      listeners.add(listener);
      queueMicrotask(() => {
        listener('INITIAL_SESSION', session);
      });
      return {
        data: {
          subscription: {
            id: 'fake',
            callback: listener,
            unsubscribe: () => {
              listeners.delete(listener);
            },
          },
        },
      };
    }),
    getSession: vi.fn(() => Promise.resolve({ data: { session }, error: null })),
    refreshSession: vi.fn(() => Promise.resolve({ data: { session, user: null }, error: null })),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    resetPasswordForEmail: vi.fn<AuthClient['resetPasswordForEmail']>(() =>
      Promise.resolve({ data: {}, error: null }),
    ),
    updateUser: vi.fn(),
    signOut: vi.fn(() => {
      emit('SIGNED_OUT', null);
      return Promise.resolve({ error: null });
    }),
  };

  return { client: mocks as unknown as AuthClient, mocks, emit };
}
