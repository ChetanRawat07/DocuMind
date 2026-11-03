import { z } from 'zod';
import { DOCUMENT_TYPES } from './documents.js';

/** The ranges analytics offers, in days ending today. 90 bounds every query. */
export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];
export const DEFAULT_ANALYTICS_RANGE: AnalyticsRange = 30;

/** True for an IANA timezone name this runtime knows, such as `Asia/Kolkata`. */
export function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/**
 * `GET /analytics`. `tz` is the viewer's IANA timezone: it decides where a
 * day starts, both for the window and for the daily volume.
 */
export const analyticsQuerySchema = z.object({
  days: z.coerce
    .number()
    .refine(
      (days): days is AnalyticsRange => (ANALYTICS_RANGES as readonly number[]).includes(days),
      {
        message: `Must be one of ${ANALYTICS_RANGES.join(', ')}`,
      },
    )
    .default(DEFAULT_ANALYTICS_RANGE),
  tz: z.string().max(64).refine(isTimeZone, { message: 'Unknown timezone' }).default('UTC'),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

/** Overall-confidence buckets; the top one starts at the review threshold. */
export const CONFIDENCE_BUCKETS = [
  { id: 'below_50', min: 0, max: 0.5 },
  { id: '50_to_70', min: 0.5, max: 0.7 },
  { id: '70_to_90', min: 0.7, max: 0.9 },
  { id: '90_and_above', min: 0.9, max: 1 },
] as const;
export type ConfidenceBucket = (typeof CONFIDENCE_BUCKETS)[number]['id'];

const count = z.number().int().nonnegative();
const rate = z.number().min(0).max(1).nullable();

/**
 * The signed-in user's analytics over the documents whose processing
 * reached an outcome in the window (the last `days` local days, today
 * included). Rates are null when there is nothing to divide by.
 */
export const analyticsSchema = z.object({
  days: z.number().int().positive(),
  timezone: z.string(),
  /** First day of the window, `YYYY-MM-DD` in `timezone`. */
  since: z.iso.date(),
  documents: z.object({
    uploaded: count,
    /** Reached an outcome: extracted (in review, completed or rejected) or failed. */
    processed: count,
    succeeded: count,
    failed: count,
    /** Waiting for review now, whatever the window. */
    needsReview: count,
  }),
  successRate: rate,
  failureRate: rate,
  /** Succeeded jobs, first start to finish (retries included). Milliseconds. */
  processingMs: z.object({
    average: count.nullable(),
    p95: count.nullable(),
  }),
  documentTypes: z.array(
    z.object({ type: z.enum([...DOCUMENT_TYPES, 'unclassified']), count: count }),
  ),
  /** Latest extraction of each processed, extracted document. */
  confidence: z.array(z.object({ bucket: z.enum(CONFIDENCE_BUCKETS.map((b) => b.id)), count })),
  review: z.object({
    extracted: count,
    /** Confident enough to complete without a person. */
    autoCompleted: count,
    approvedAfterReview: count,
    rejected: count,
    pending: count,
    /** Share of extractions that needed a person. */
    rate,
  }),
  /**
   * Of the values a person confirmed or corrected in extractions they
   * approved, how many they changed. A measure of what review caught, not
   * of accuracy overall: auto-completed extractions are not checked by anyone.
   */
  corrections: z.object({ reviewedFields: count, correctedFields: count, rate }),
  /** Every day of the window, oldest first. */
  volume: z.array(z.object({ date: z.iso.date(), processed: count, failed: count })),
});
export type Analytics = z.infer<typeof analyticsSchema>;
