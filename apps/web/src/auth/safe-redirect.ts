/**
 * Where to go after sign-in. Only same-app paths are allowed: `//evil.test`
 * and `/\evil.test` are protocol-relative URLs to another site, so taking the
 * value as-is would be an open redirect.
 */
export function safeRedirectPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}
