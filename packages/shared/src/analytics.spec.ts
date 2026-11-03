import { describe, expect, it } from 'vitest';
import { analyticsQuerySchema, CONFIDENCE_BUCKETS, isTimeZone } from './analytics.js';
import { REVIEW_CONFIDENCE_THRESHOLD } from './review.js';

describe('analyticsQuerySchema', () => {
  it('defaults to 30 days in UTC', () => {
    expect(analyticsQuerySchema.parse({})).toEqual({ days: 30, tz: 'UTC' });
  });

  it('accepts the offered ranges and real timezones', () => {
    expect(analyticsQuerySchema.parse({ days: '90', tz: 'Asia/Kolkata' })).toEqual({
      days: 90,
      tz: 'Asia/Kolkata',
    });
  });

  it.each([
    [{ days: '14' }],
    [{ days: 'all' }],
    [{ tz: 'Mars/Olympus' }],
    [{ tz: "UTC'; DROP TABLE documents; --" }],
  ])('rejects %j', (query) => {
    expect(analyticsQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('isTimeZone', () => {
  it('knows IANA names and rejects the rest', () => {
    expect(isTimeZone('America/Los_Angeles')).toBe(true);
    expect(isTimeZone('Not/AZone')).toBe(false);
  });
});

describe('CONFIDENCE_BUCKETS', () => {
  it('cover 0 to 1 without gaps, the top one starting at the review threshold', () => {
    expect(CONFIDENCE_BUCKETS[0].min).toBe(0);
    expect(CONFIDENCE_BUCKETS.at(-1)?.max).toBe(1);
    for (let index = 1; index < CONFIDENCE_BUCKETS.length; index += 1) {
      expect(CONFIDENCE_BUCKETS[index]?.min).toBe(CONFIDENCE_BUCKETS[index - 1]?.max);
    }
    expect(CONFIDENCE_BUCKETS.at(-1)?.min).toBe(REVIEW_CONFIDENCE_THRESHOLD);
  });
});
