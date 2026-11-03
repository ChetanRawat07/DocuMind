import { describe, expect, it } from 'vitest';
import { auditLogQuerySchema } from './audit.js';

describe('auditLogQuerySchema', () => {
  it('accepts a cursor up to the largest bigint id', () => {
    expect(auditLogQuerySchema.parse({ cursor: '9223372036854775807' }).cursor).toBe(
      '9223372036854775807',
    );
  });

  it.each(['9223372036854775808', '9999999999999999999', '-1', '1.5', ''])(
    'rejects cursor %j',
    (cursor) => {
      expect(auditLogQuerySchema.safeParse({ cursor }).success).toBe(false);
    },
  );
});
