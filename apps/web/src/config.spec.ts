import { describe, expect, it } from 'vitest';
import { loadWebConfig } from './config';

const valid = {
  VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
};

describe('loadWebConfig', () => {
  it('reads the Supabase URL and publishable key', () => {
    expect(loadWebConfig(valid)).toEqual({
      supabaseUrl: valid.VITE_SUPABASE_URL,
      supabasePublishableKey: valid.VITE_SUPABASE_PUBLISHABLE_KEY,
    });
  });

  it('names every missing variable', () => {
    expect(() => loadWebConfig({})).toThrow(
      'Missing or invalid web configuration: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY.',
    );
  });

  it.each(['javascript:alert(1)', 'ftp://example.test', 'not a url'])(
    'rejects the URL %s without echoing it',
    (url) => {
      expect(() => loadWebConfig({ ...valid, VITE_SUPABASE_URL: url })).toThrow(
        /^Missing or invalid web configuration: VITE_SUPABASE_URL\. See \.env\.example\.$/,
      );
    },
  );

  it('rejects an empty publishable key', () => {
    expect(() => loadWebConfig({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: '' })).toThrow(
      'VITE_SUPABASE_PUBLISHABLE_KEY',
    );
  });
});
