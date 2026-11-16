import type { Session } from '@supabase/supabase-js';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { setApiCacheUser } from '../services/use-api-query';
import type { AuthClient } from './auth-client';
import { AuthContext, type AuthStatus } from './use-auth';

/**
 * Tracks the Supabase session. onAuthStateChange reports the stored session
 * first (INITIAL_SESSION), then sign-ins, token refreshes and sign-outs from
 * this and other tabs, so the UI never acts on a stale session. The API
 * cache is cleared whenever the user changes (sign-in, sign-out, another
 * account in another tab), so one user's data never shows for another.
 */
export function AuthProvider({ client, children }: { client: AuthClient; children: ReactNode }) {
  const [state, setState] = useState<{ status: AuthStatus; session: Session | null }>({
    status: 'loading',
    session: null,
  });

  useEffect(() => {
    // The callback only stores state: supabase-js warns that awaiting other
    // auth calls inside it can deadlock.
    const { data } = client.onAuthStateChange((_event, session) => {
      setApiCacheUser(session?.user.id);
      setState({ status: session ? 'signed_in' : 'signed_out', session });
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, [client]);

  const value = useMemo(() => ({ ...state, client }), [state, client]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
