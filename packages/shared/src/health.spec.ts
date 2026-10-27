import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health.js';

describe('healthResponseSchema', () => {
  it('accepts a well-formed liveness response', () => {
    const result = healthResponseSchema.safeParse({
      status: 'ok',
      timestamp: '2026-10-26T10:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unexpected status', () => {
    const result = healthResponseSchema.safeParse({
      status: 'degraded',
      timestamp: '2026-10-26T10:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO timestamp', () => {
    const result = healthResponseSchema.safeParse({ status: 'ok', timestamp: 'yesterday' });
    expect(result.success).toBe(false);
  });
});
