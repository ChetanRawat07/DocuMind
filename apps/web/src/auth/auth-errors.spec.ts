import { AuthApiError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { passwordUpdateErrorMessage, signInErrorMessage, signUpErrorMessage } from './auth-errors';

const SERVER_TEXT = '<img src=x onerror=alert(1)> internal detail';
const authError = (code: string | undefined) => new AuthApiError(SERVER_TEXT, 400, code);

describe('auth error messages', () => {
  it.each([
    [signInErrorMessage, 'invalid_credentials', 'Invalid email or password.'],
    [signInErrorMessage, 'email_not_confirmed', 'Confirm your email address first'],
    [signInErrorMessage, 'over_request_rate_limit', 'Too many attempts.'],
    [signUpErrorMessage, 'weak_password', 'Choose a stronger password'],
    [signUpErrorMessage, 'email_address_invalid', 'Enter a valid email address.'],
    [signUpErrorMessage, 'over_email_send_rate_limit', 'Too many attempts.'],
    [signUpErrorMessage, 'signup_disabled', 'Sign-up is currently disabled.'],
    [passwordUpdateErrorMessage, 'same_password', 'different from your current one'],
    [passwordUpdateErrorMessage, 'session_expired', 'This reset link has expired.'],
    [passwordUpdateErrorMessage, 'session_not_found', 'This reset link has expired.'],
  ])('maps %#: %s to fixed text', (message, code, expected) => {
    expect(message(authError(code))).toContain(expected);
  });

  // Supabase reports some failures with codes that would reveal whether an
  // email is registered; sign-in must answer them like a wrong password or generically.
  it.each(['user_not_found', 'user_banned', 'unexpected_failure', undefined])(
    'gives sign-in code %s the generic message, never the server text',
    (code) => {
      const text = signInErrorMessage(authError(code));
      expect(text).toBe('Sign-in failed. Please try again.');
    },
  );

  it.each([signInErrorMessage, signUpErrorMessage, passwordUpdateErrorMessage])(
    'never renders the server message (%#)',
    (message) => {
      for (const code of ['invalid_credentials', 'weak_password', 'something_new', undefined]) {
        expect(message(authError(code))).not.toContain(SERVER_TEXT);
      }
    },
  );
});
