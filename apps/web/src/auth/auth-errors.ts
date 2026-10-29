import type { AuthError } from '@supabase/supabase-js';

/**
 * User-facing text for Supabase Auth errors. Messages are fixed strings so
 * nothing from the server is rendered, and sign-in failures never reveal
 * whether an email is registered.
 */
export function signInErrorMessage(error: AuthError): string {
  switch (error.code) {
    case 'invalid_credentials':
      return 'Invalid email or password.';
    case 'email_not_confirmed':
      return 'Confirm your email address first, using the link we sent you.';
    case 'over_request_rate_limit':
      return 'Too many attempts. Wait a moment and try again.';
    default:
      return 'Sign-in failed. Please try again.';
  }
}

export function signUpErrorMessage(error: AuthError): string {
  switch (error.code) {
    case 'weak_password':
      return 'Choose a stronger password: at least 8 characters, not a common one.';
    case 'email_address_invalid':
      return 'Enter a valid email address.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many attempts. Wait a moment and try again.';
    case 'signup_disabled':
      return 'Sign-up is currently disabled.';
    default:
      return 'Sign-up failed. Please try again.';
  }
}

export function passwordUpdateErrorMessage(error: AuthError): string {
  switch (error.code) {
    case 'weak_password':
      return 'Choose a stronger password: at least 8 characters, not a common one.';
    case 'same_password':
      return 'Choose a password different from your current one.';
    case 'session_expired':
    case 'session_not_found':
      return 'This reset link has expired. Request a new one.';
    default:
      return 'Could not update the password. Please try again.';
  }
}
