import {
  type Analytics,
  CONFIDENCE_BUCKETS,
  type ConfidenceBucket,
  type DocumentType,
} from '@documind/shared';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE } from '../database/database.module.js';
import type { DatabaseExecutor } from '../database/database.types.js';

/** PostgreSQL invalid_parameter_value: raised for a timezone it does not know. */
const INVALID_PARAMETER_VALUE = '22023';

/** The timezone passed validation here but PostgreSQL does not know it. */
export class UnknownTimeZoneError extends Error {
  constructor(timezone: string) {
    super(`Unknown timezone: ${timezone}`);
    this.name = 'UnknownTimeZoneError';
  }
}

/** Postgres returns counts (bigint) and averages (numeric) as strings. */
const toNumber = (value: string | number | null): number => Number(value ?? 0);
const roundOrNull = (value: string | number | null): number | null =>
  value === null ? null : Math.round(Number(value));
const ratio = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);

/**
 * Analytics for one user. Every query starts from the user's documents whose
 * processing reached an outcome in the window, found through
 * `documents_user_id_processed_at_idx`, so the cost follows the window, not
 * the user's whole history. Each document counts once, by its latest
 * outcome. Definitions: docs/operations/analytics.md.
 */
@Injectable()
export class AnalyticsRepository {
  constructor(@Inject(DATABASE) private readonly db: DatabaseExecutor) {}

  async forUser(
    userId: string,
    days: number,
    timezone: string,
  ): Promise<Omit<Analytics, 'days' | 'timezone'>> {
    try {
      // One snapshot, so the numbers agree with each other.
      return await this.db
        .transaction()
        .setIsolationLevel('repeatable read')
        .setAccessMode('read only')
        .execute((trx) => this.compute(trx, userId, days, timezone));
    } catch (error) {
      if ((error as { code?: unknown }).code === INVALID_PARAMETER_VALUE) {
        throw new UnknownTimeZoneError(timezone);
      }
      throw error;
    }
  }

  private async compute(
    trx: DatabaseExecutor,
    userId: string,
    days: number,
    timezone: string,
  ): Promise<Omit<Analytics, 'days' | 'timezone'>> {
    // Local midnight `days - 1` days ago, as an instant: the window includes today.
    const window = (
      await sql<{ start: Date; since: string; today: string }>`
        SELECT start, to_char(start AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS since,
               to_char(now() AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS today
        FROM (SELECT (date_trunc('day', now() AT TIME ZONE ${timezone})
                      - make_interval(days => ${days - 1})) AT TIME ZONE ${timezone} AS start) w
      `.execute(trx)
    ).rows[0];
    if (!window) throw new Error('The window query returned no row');
    const processed = sql`
      SELECT d.id, d.status, d.document_type, d.processed_at
      FROM documents d
      WHERE d.user_id = ${userId} AND d.processed_at >= ${window.start}`;
    // The latest extraction of each processed document that was extracted, with its review.
    const latest = sql`
      SELECT e.id, e.overall_confidence, e.fields, r.decision, r.decided_by, r.fields AS reviewed
      FROM (${processed}) p
      CROSS JOIN LATERAL (
        SELECT x.id, x.overall_confidence, x.fields FROM document_extractions x
        WHERE x.document_id = p.id ORDER BY x.created_at DESC, x.id DESC LIMIT 1
      ) e
      LEFT JOIN extraction_reviews r ON r.extraction_id = e.id
      WHERE p.status <> 'failed'`;

    const totals = (
      await sql<Record<string, string>>`
        SELECT
          (SELECT count(*) FROM documents
           WHERE user_id = ${userId} AND created_at >= ${window.start}) AS uploaded,
          (SELECT count(*) FROM documents
           WHERE user_id = ${userId} AND status = 'needs_review') AS needs_review,
          count(*) AS processed,
          count(*) FILTER (WHERE p.status = 'failed') AS failed
        FROM (${processed}) p
      `.execute(trx)
    ).rows[0] as Record<string, string>;

    const timing = (
      await sql<{ average: string | null; p95: number | null }>`
        SELECT avg(extract(epoch FROM j.finished_at - j.started_at) * 1000) AS average,
               percentile_cont(0.95) WITHIN GROUP (
                 ORDER BY extract(epoch FROM j.finished_at - j.started_at) * 1000) AS p95
        FROM (${processed}) p
        JOIN processing_jobs j ON j.document_id = p.id
        WHERE j.status = 'succeeded' AND j.finished_at >= ${window.start}
      `.execute(trx)
    ).rows[0];

    const types = await sql<{ type: DocumentType | null; count: string }>`
      SELECT p.document_type AS type, count(*) AS count
      FROM (${processed}) p
      GROUP BY p.document_type
      ORDER BY count(*) DESC, p.document_type NULLS LAST
    `.execute(trx);

    const bucketCase = sql.join(
      CONFIDENCE_BUCKETS.map((bucket, index) =>
        index === CONFIDENCE_BUCKETS.length - 1
          ? sql`ELSE ${bucket.id}`
          : sql`WHEN l.overall_confidence < ${bucket.max} THEN ${bucket.id}`,
      ),
      sql` `,
    );
    const confidence = await sql<{ bucket: ConfidenceBucket; count: string }>`
      SELECT CASE ${bucketCase} END AS bucket, count(*) AS count
      FROM (${latest}) l
      GROUP BY 1
    `.execute(trx);

    const review = (
      await sql<Record<string, string>>`
        SELECT count(*) AS extracted,
               count(*) FILTER (WHERE l.decision = 'approved' AND l.decided_by IS NULL) AS auto,
               count(*) FILTER (WHERE l.decision = 'approved' AND l.decided_by IS NOT NULL) AS approved,
               count(*) FILTER (WHERE l.decision = 'rejected') AS rejected,
               count(*) FILTER (WHERE l.decision IS NULL) AS pending
        FROM (${latest}) l
      `.execute(trx)
    ).rows[0] as Record<string, string>;

    // jsonb equality compares values, so 58200 and 58200.0 count as unchanged.
    const corrections = (
      await sql<{ reviewed: string; corrected: string }>`
        SELECT count(*) AS reviewed,
               count(*) FILTER (WHERE f.value -> 'value' IS DISTINCT FROM l.fields -> f.key -> 'value')
                 AS corrected
        FROM (${latest}) l
        CROSS JOIN LATERAL jsonb_each(l.reviewed) f
        WHERE l.decision = 'approved' AND l.decided_by IS NOT NULL
      `.execute(trx)
    ).rows[0];

    // Dates, not timestamps: generate_series over local dates is safe across DST changes.
    const volume = await sql<{ date: string; processed: string; failed: string }>`
      SELECT to_char(day, 'YYYY-MM-DD') AS date,
             count(p.id) AS processed,
             count(p.id) FILTER (WHERE p.status = 'failed') AS failed
      FROM generate_series(${window.since}::date, ${window.today}::date, interval '1 day') day
      LEFT JOIN (${processed}) p ON (p.processed_at AT TIME ZONE ${timezone})::date = day::date
      GROUP BY day
      ORDER BY day
    `.execute(trx);

    const processedCount = toNumber(totals.processed ?? null);
    const failed = toNumber(totals.failed ?? null);
    const extracted = toNumber(review.extracted ?? null);
    const autoCompleted = toNumber(review.auto ?? null);
    const reviewedFields = toNumber(corrections?.reviewed ?? null);
    const correctedFields = toNumber(corrections?.corrected ?? null);
    const confidenceCounts = new Map(
      confidence.rows.map((row) => [row.bucket, toNumber(row.count)]),
    );
    return {
      since: window.since,
      documents: {
        uploaded: toNumber(totals.uploaded ?? null),
        processed: processedCount,
        succeeded: processedCount - failed,
        failed,
        needsReview: toNumber(totals.needs_review ?? null),
      },
      successRate: ratio(processedCount - failed, processedCount),
      failureRate: ratio(failed, processedCount),
      processingMs: {
        average: roundOrNull(timing?.average ?? null),
        p95: roundOrNull(timing?.p95 ?? null),
      },
      documentTypes: types.rows.map((row) => ({
        type: row.type ?? 'unclassified',
        count: toNumber(row.count),
      })),
      confidence: CONFIDENCE_BUCKETS.map((bucket) => ({
        bucket: bucket.id,
        count: confidenceCounts.get(bucket.id) ?? 0,
      })),
      review: {
        extracted,
        autoCompleted,
        approvedAfterReview: toNumber(review.approved ?? null),
        rejected: toNumber(review.rejected ?? null),
        pending: toNumber(review.pending ?? null),
        rate: ratio(extracted - autoCompleted, extracted),
      },
      corrections: {
        reviewedFields,
        correctedFields,
        rate: ratio(correctedFields, reviewedFields),
      },
      volume: volume.rows.map((row) => ({
        date: row.date,
        processed: toNumber(row.processed),
        failed: toNumber(row.failed),
      })),
    };
  }
}
