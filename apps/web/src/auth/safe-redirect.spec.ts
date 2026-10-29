import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from './safe-redirect';

describe('safeRedirectPath', () => {
  it.each(['/', '/documents', '/documents/42?tab=review'])('keeps the in-app path %s', (path) => {
    expect(safeRedirectPath(path)).toBe(path);
  });

  it.each([
    ['a protocol-relative URL', '//evil.test/phish'],
    ['a backslash protocol-relative URL', '/\\evil.test'],
    ['an absolute URL', 'https://evil.test'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a relative path', 'documents'],
    ['a non-string', { pathname: '/' }],
    ['nothing', undefined],
  ])('falls back to / for %s', (_case, value) => {
    expect(safeRedirectPath(value)).toBe('/');
  });
});
