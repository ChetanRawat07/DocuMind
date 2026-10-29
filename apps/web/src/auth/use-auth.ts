import type { Session } from '@supabase/supabase-js';
import { createContext, useContext } from 'react';
import type { AuthClient } from './auth-client';

export type AuthStatus = 'loading' | 'signed_in' | 'signed_out';

export interface AuthContextValue {
  readonly status: AuthStatus;
  readonly session: Session | null;
  readonly client: AuthClient;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return value;
}
