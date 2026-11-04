import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from './content-security-policy';

const directives = (policy: string): Record<string, string[]> =>
  Object.fromEntries(
    policy.split('; ').map((directive): [string, string[]] => {
      const [name = '', ...values] = directive.split(' ');
      return [name, values];
    }),
  );

describe('contentSecurityPolicy', () => {
  const policy = directives(contentSecurityPolicy('https://abc.supabase.co/'));

  it('runs only the app’s own scripts: no inline code or eval', () => {
    expect(policy['script-src']).toEqual(["'self'"]);
    expect(policy['default-src']).toEqual(["'self'"]);
  });

  it('sends requests only to the app’s origin and Supabase', () => {
    expect(policy['connect-src']).toEqual(["'self'", 'https://abc.supabase.co']);
  });

  it('also allows the API’s host when it is on another origin', () => {
    const crossOrigin = directives(
      contentSecurityPolicy('https://abc.supabase.co', 'https://documind-api.onrender.com'),
    );
    expect(crossOrigin['connect-src']).toEqual([
      "'self'",
      'https://abc.supabase.co',
      'https://documind-api.onrender.com',
    ]);
  });

  it('allows blob previews, and no plugins, frames or base or form hijacking', () => {
    expect(policy['object-src']).toEqual(['blob:']);
    expect(policy['img-src']).toEqual(["'self'", 'blob:', 'data:']);
    expect(policy['frame-src']).toEqual(["'none'"]);
    expect(policy['base-uri']).toEqual(["'self'"]);
    expect(policy['form-action']).toEqual(["'self'"]);
  });
});
