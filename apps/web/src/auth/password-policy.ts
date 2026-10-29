/**
 * Client-side hints only; Supabase enforces the real policy (set its minimum
 * length to match in the dashboard). bcrypt, which Supabase uses, ignores
 * bytes beyond 72, so longer passwords would be silently truncated.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;
