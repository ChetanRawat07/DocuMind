import { describe, expect, it } from 'vitest';
import { apiOrigin } from './api-origin';

describe('apiOrigin', () => {
  it('is empty when the API shares the web app’s origin', () => {
    expect(apiOrigin(undefined)).toBe('');
    expect(apiOrigin('')).toBe('');
  });

  it.each(['https://documind-api.onrender.com', 'http://localhost:3000'])('accepts %s', (url) => {
    expect(apiOrigin(url)).toBe(url);
  });

  it.each([
    'http://documind-api.onrender.com',
    'https://documind-api.onrender.com/',
    'https://documind-api.onrender.com/api/v1',
    'javascript:alert(1)',
    'not a url',
  ])('rejects %s', (url) => {
    expect(() => apiOrigin(url)).toThrow('VITE_API_URL');
  });
});
