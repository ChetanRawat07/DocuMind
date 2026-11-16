/**
 * Client-side hints only; Supabase enforces the real policy (set its minimum
 * length to match in the dashboard). bcrypt, which Supabase uses, ignores
 * bytes beyond 72, so longer passwords would be silently truncated.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

export const PASSWORD_STRENGTH_LABELS = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'] as const;

/**
 * 0 below the minimum length, then one point each for the minimum, 12 or more
 * characters, mixed case, and a digit or symbol. A nudge, not a policy.
 */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (password.length < PASSWORD_MIN_LENGTH) return 0;
  const points =
    1 +
    Number(password.length >= 12) +
    Number(/[a-z]/.test(password) && /[A-Z]/.test(password)) +
    Number(/[\d\W_]/.test(password));
  return Math.min(points, 4) as 1 | 2 | 3 | 4;
}
