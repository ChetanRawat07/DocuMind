import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { WebConfig } from '../config';

/** The part of Supabase the app uses. A narrow type keeps tests' fakes small. */
export type AuthClient = Pick<
  SupabaseClient['auth'],
  | 'getSession'
  | 'onAuthStateChange'
  | 'refreshSession'
  | 'resetPasswordForEmail'
  | 'signInWithPassword'
  | 'signOut'
  | 'signUp'
  | 'updateUser'
>;

/**
 * Supabase Auth client. supabase-js keeps the session in localStorage and
 * refreshes the short-lived access token before it expires. PKCE makes email
 * links (password reset) carry a one-time code instead of tokens in the URL.
 */
export function createAuthClient(config: WebConfig): AuthClient {
  return createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }).auth;
}
