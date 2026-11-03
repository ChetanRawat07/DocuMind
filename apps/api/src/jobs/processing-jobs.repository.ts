import {
  ACTIVE_PROCESSING_JOB_STATUSES,
  type ProcessingJobStatus,
  type ProcessingStage,
} from '@documind/shared';
import { Inject, Injectable } from '@nestjs/common';
import { type ExpressionBuilder, type Selectable, sql, type UpdateObject } from 'kysely';
import { currentCorrelation } from '../common/correlation/correlation.js';
import { DATABASE } from '../database/database.module.js';
import type { Database, DatabaseExecutor } from '../database/database.types.js';
import type { ProcessingJobs } from '../database/generated/database.js';

/** Bounds the enqueue retry loop; see enqueue(). Reaching it means heavy contention or a bug. */
const MAX_ENQUEUE_ATTEMPTS = 3;

/** The column's CHECK limit. */
const MAX_ERROR_MESSAGE_LENGTH = 2000;

/** Why a job attempt failed. The message describes the file or service, never document content. */
export interface JobError {
  readonly code: string;
  readonly message: string;
}

export interface ProcessingJob {
  readonly id: string;
  readonly documentId: string;
  readonly status: ProcessingJobStatus;
  readonly stage: ProcessingStage | null;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly availableAt: Date;
  readonly lockedBy: string | null;
  readonly lockedAt: Date | null;
  readonly leaseExpiresAt: Date | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
  /** The API request that queued the job; null for jobs queued by the system. */
  readonly requestId: string | null;
  /** Duration of each step in the attempt that last ran it; null until it has run. */
  readonly textExtractionMs: number | null;
  readonly aiMs: number | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A job listed across the owner's documents, with the document's name. */
export interface OwnedProcessingJob extends ProcessingJob {
  readonly documentFilename: string;
}

/** Durations in milliseconds over the summary window; null without data. */
export interface DurationStats {
  readonly average: number | null;
  readonly p95: number | null;
}

/** The owner's queue now, and how processing went over the last `windowDays`. */
export interface ProcessingSummary {
  readonly queued: number;
  readonly running: number;
  readonly oldestQueuedAt: Date | null;
  readonly succeeded: number;
  readonly failed: number;
  readonly failuresByCode: readonly { readonly code: string; readonly count: number }[];
  /** First start to finish of succeeded jobs, retries and backoff included. */
  readonly processingMs: DurationStats;
  readonly textExtractionMs: DurationStats;
  readonly aiMs: DurationStats;
}

export interface EnqueueResult {
  readonly job: ProcessingJob;
  /** false when an active job already existed and was returned instead. */
  readonly created: boolean;
}

/**
 * Job persistence and the queue's state machine (docs/processing/job-queue.md):
 *
 *   queued ──claim──> running ──> succeeded
 *     ^                  │
 *     └── retry/lease ───┴──────> failed (dead letter)
 *
 * A claimed job belongs to one worker until its lease expires. Every write
 * after the claim is fenced by `heldBy`: it changes the row only while that
 * attempt is still the current one, so a worker whose lease expired and whose
 * job was taken over cannot overwrite the new attempt.
 *
 * Callers must have verified document ownership first.
 */
@Injectable()
export class ProcessingJobsRepository {
  constructor(@Inject(DATABASE) private readonly db: DatabaseExecutor) {}

  /**
   * Creates a queued job unless the document already has an active one, in
   * which case that job is returned. The partial unique index makes the
   * database the arbiter, so duplicate requests or concurrent callers can
   * never produce two active jobs.
   *
   * The loop covers a narrow race: the insert conflicts with an active job
   * that finishes before we read it back. Trying again then succeeds.
   */
  async enqueue(documentId: string, executor = this.db): Promise<EnqueueResult> {
    for (let attempt = 1; attempt <= MAX_ENQUEUE_ATTEMPTS; attempt += 1) {
      const inserted = await executor
        .insertInto('processing_jobs')
        // The request that queued the job follows it into the worker's logs and audit entries.
        .values((eb) => ({
          document_id: documentId,
          // A copy of the owner for the per-user indexes; the composite foreign key checks it.
          user_id: eb.selectFrom('documents').select('user_id').where('id', '=', documentId),
          request_id: currentCorrelation().requestId ?? null,
        }))
        .onConflict((conflict) =>
          conflict
            .column('document_id')
            .where('status', 'in', ACTIVE_PROCESSING_JOB_STATUSES)
            .doNothing(),
        )
        .returningAll()
        .executeTakeFirst();
      if (inserted) {
        return { job: toProcessingJob(inserted), created: true };
      }

      const existing = await this.findActiveForDocument(documentId, executor);
      if (existing) {
        return { job: existing, created: false };
      }
    }
    throw new Error(`Could not enqueue a job for document ${documentId}`);
  }

  async findActiveForDocument(
    documentId: string,
    executor = this.db,
  ): Promise<ProcessingJob | null> {
    const row = await executor
      .selectFrom('processing_jobs')
      .selectAll()
      .where('document_id', '=', documentId)
      .where('status', 'in', ACTIVE_PROCESSING_JOB_STATUSES)
      .executeTakeFirst();
    return row ? toProcessingJob(row) : null;
  }

  /** A document's most recent jobs, newest first. */
  async listForDocument(
    documentId: string,
    limit: number,
    executor = this.db,
  ): Promise<ProcessingJob[]> {
    const rows = await executor
      .selectFrom('processing_jobs')
      .selectAll()
      .where('document_id', '=', documentId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .execute();
    return rows.map(toProcessingJob);
  }

  /**
   * The owner's most recent jobs across all documents, newest first,
   * optionally of one status.
   */
  async listForOwner(
    ownerId: string,
    options: { readonly status?: ProcessingJobStatus | undefined; readonly limit: number },
    executor = this.db,
  ): Promise<OwnedProcessingJob[]> {
    const rows = await executor
      .selectFrom('processing_jobs')
      .innerJoin('documents', 'documents.id', 'processing_jobs.document_id')
      .selectAll('processing_jobs')
      .select('documents.original_filename')
      .where('processing_jobs.user_id', '=', ownerId)
      .$if(options.status !== undefined, (query) =>
        query.where('processing_jobs.status', '=', options.status as ProcessingJobStatus),
      )
      .orderBy('processing_jobs.created_at', 'desc')
      .orderBy('processing_jobs.id', 'desc')
      .limit(options.limit)
      .execute();
    return rows.map((row) => ({
      ...toProcessingJob(row),
      documentFilename: row.original_filename,
    }));
  }

  /**
   * Counts and durations for the owner's documents: the queue as it is now,
   * and jobs that finished within the last `windowDays`.
   */
  async summaryForOwner(
    ownerId: string,
    windowDays: number,
    executor = this.db,
  ): Promise<ProcessingSummary> {
    const recent = sql`j.finished_at > now() - make_interval(days => ${windowDays})`;
    const succeededRecently = sql`j.status = 'succeeded' AND ${recent}`;
    const processing = sql`extract(epoch FROM j.finished_at - j.started_at) * 1000`;
    const stats = (
      value: ReturnType<typeof sql>,
      filter: ReturnType<typeof sql>,
      name: string,
    ) => sql`
      avg(${value}) FILTER (WHERE ${filter}) AS ${sql.ref(`${name}_avg`)},
      percentile_cont(0.95) WITHIN GROUP (ORDER BY ${value}) FILTER (WHERE ${filter})
        AS ${sql.ref(`${name}_p95`)}`;

    const totals = await sql<SummaryRow>`
      SELECT
        count(*) FILTER (WHERE j.status = 'queued') AS queued,
        count(*) FILTER (WHERE j.status = 'running') AS running,
        min(j.created_at) FILTER (WHERE j.status = 'queued') AS oldest_queued_at,
        count(*) FILTER (WHERE ${succeededRecently}) AS succeeded,
        count(*) FILTER (WHERE j.status = 'failed' AND ${recent}) AS failed,
        ${stats(processing, succeededRecently, 'processing')},
        ${stats(sql`j.text_extraction_ms`, recent, 'text_extraction')},
        ${stats(sql`j.ai_ms`, recent, 'ai')}
      FROM processing_jobs j
      -- Active jobs have no finished_at; with the window, this bounds the read on its index.
      WHERE j.user_id = ${ownerId} AND (j.finished_at IS NULL OR ${recent})
    `.execute(executor);
    const failures = await sql<{ code: string; count: string }>`
      SELECT j.last_error_code AS code, count(*) AS count
      FROM processing_jobs j
      WHERE j.user_id = ${ownerId} AND j.status = 'failed' AND ${recent}
        AND j.last_error_code IS NOT NULL
      GROUP BY j.last_error_code
      ORDER BY count(*) DESC, j.last_error_code
      LIMIT 10
    `.execute(executor);

    // Aggregates always return one row.
    const row = totals.rows[0] as SummaryRow;
    const duration = (name: 'processing' | 'text_extraction' | 'ai'): DurationStats => ({
      average: roundOrNull(row[`${name}_avg`]),
      p95: roundOrNull(row[`${name}_p95`]),
    });
    return {
      queued: Number(row.queued),
      running: Number(row.running),
      oldestQueuedAt: row.oldest_queued_at,
      succeeded: Number(row.succeeded),
      failed: Number(row.failed),
      failuresByCode: failures.rows.map((failure) => ({
        code: failure.code,
        count: Number(failure.count),
      })),
      processingMs: duration('processing'),
      textExtractionMs: duration('text_extraction'),
      aiMs: duration('ai'),
    };
  }

  /**
   * Claims the oldest job that is due and starts an attempt. SKIP LOCKED makes
   * concurrent workers pass over a row another worker is claiming instead of
   * waiting for it, so each job goes to exactly one worker. Queued jobs always
   * have attempts left: running out of them fails the job instead.
   */
  async claimNext(
    workerId: string,
    leaseMs: number,
    executor = this.db,
  ): Promise<ProcessingJob | null> {
    const row = await executor
      .updateTable('processing_jobs')
      .set({
        status: 'running',
        attempts: sql`attempts + 1`,
        locked_by: workerId,
        locked_at: sql`now()`,
        lease_expires_at: sql`now() + make_interval(secs => ${leaseMs / 1000}::float8)`,
        started_at: sql`coalesce(started_at, now())`,
      })
      .where('id', '=', (eb) =>
        eb
          .selectFrom('processing_jobs')
          .select('id')
          .where('status', '=', 'queued')
          .where('available_at', '<=', sql<Date>`now()`)
          .orderBy('available_at')
          .limit(1)
          .forUpdate()
          .skipLocked(),
      )
      .returningAll()
      .executeTakeFirst();
    return row ? toProcessingJob(row) : null;
  }

  /**
   * Releases jobs whose lease ran out before their worker finished them
   * (crash, kill, lost connection): back to the queue while attempts
   * remain, failed otherwise. A job that crashes its worker every time
   * therefore ends in the dead letter after `max_attempts` crashes instead of
   * looping forever. Returns the released jobs.
   */
  async releaseExpired(executor = this.db): Promise<ProcessingJob[]> {
    const exhausted = sql<boolean>`attempts >= max_attempts`;
    const rows = await executor
      .updateTable('processing_jobs')
      .set({
        status: sql`CASE WHEN ${exhausted} THEN 'failed' ELSE 'queued' END`,
        finished_at: sql`CASE WHEN ${exhausted} THEN now() END`,
        available_at: sql`now()`,
        locked_by: null,
        locked_at: null,
        lease_expires_at: null,
        last_error_code: 'lease_expired',
        last_error_message: 'The worker stopped before the job finished',
      })
      .where('status', '=', 'running')
      .where('lease_expires_at', '<', sql<Date>`now()`)
      .returningAll()
      .execute();
    return rows.map(toProcessingJob);
  }

  /** Records progress. Returns false when the worker no longer holds the job. */
  async setStage(job: ProcessingJob, stage: ProcessingStage, executor = this.db): Promise<boolean> {
    const result = await executor
      .updateTable('processing_jobs')
      .set({ stage })
      .where(heldBy(job))
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  /** Records how long steps of this attempt took. Returns false when the worker no longer holds the job. */
  async recordDurations(
    job: ProcessingJob,
    durations: { readonly textExtractionMs?: number; readonly aiMs?: number },
    executor = this.db,
  ): Promise<boolean> {
    const changes = {
      ...(durations.textExtractionMs !== undefined
        ? { text_extraction_ms: Math.round(durations.textExtractionMs) }
        : {}),
      ...(durations.aiMs !== undefined ? { ai_ms: Math.round(durations.aiMs) } : {}),
    };
    if (Object.keys(changes).length === 0) return true;
    const result = await executor
      .updateTable('processing_jobs')
      .set(changes)
      .where(heldBy(job))
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  async markSucceeded(job: ProcessingJob, executor = this.db): Promise<boolean> {
    return this.finishAttempt(
      job,
      { status: 'succeeded', stage: null, finished_at: sql`now()` },
      executor,
    );
  }

  /** Returns the job to the queue, due again at `retryAt` (backoff). */
  async scheduleRetry(
    job: ProcessingJob,
    error: JobError,
    retryAt: Date,
    executor = this.db,
  ): Promise<boolean> {
    return this.finishAttempt(
      job,
      { status: 'queued', available_at: retryAt, ...errorColumns(error) },
      executor,
    );
  }

  /** Ends the job for good: the jobs table is the dead letter, queryable and kept. */
  async markFailed(job: ProcessingJob, error: JobError, executor = this.db): Promise<boolean> {
    return this.finishAttempt(
      job,
      { status: 'failed', finished_at: sql`now()`, ...errorColumns(error) },
      executor,
    );
  }

  /** Ends the current attempt and releases the lock, if the worker still holds the job. */
  private async finishAttempt(
    job: ProcessingJob,
    changes: UpdateObject<Database, 'processing_jobs'>,
    executor: DatabaseExecutor,
  ): Promise<boolean> {
    const result = await executor
      .updateTable('processing_jobs')
      .set(changes)
      .set({ locked_by: null, locked_at: null, lease_expires_at: null })
      .where(heldBy(job))
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }
}

/**
 * The fence: the row is still running in the attempt this claim started.
 * Every claim increments `attempts` and nothing else changes it, so the
 * attempt number is a fencing token: once the job is claimed again, a stale
 * attempt matches nothing, whichever worker holds it.
 */
function heldBy(job: ProcessingJob) {
  return (eb: ExpressionBuilder<Database, 'processing_jobs'>) =>
    eb.and([
      eb('id', '=', job.id),
      eb('status', '=', 'running'),
      eb('attempts', '=', job.attempts),
    ]);
}

function errorColumns(error: JobError) {
  return {
    last_error_code: error.code,
    last_error_message: error.message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
  };
}

interface SummaryRow {
  readonly queued: string;
  readonly running: string;
  readonly oldest_queued_at: Date | null;
  readonly succeeded: string;
  readonly failed: string;
  readonly processing_avg: string | number | null;
  readonly processing_p95: string | number | null;
  readonly text_extraction_avg: string | number | null;
  readonly text_extraction_p95: string | number | null;
  readonly ai_avg: string | number | null;
  readonly ai_p95: string | number | null;
}

/** Postgres returns bigint counts and numeric averages as strings. */
function roundOrNull(value: string | number | null): number | null {
  return value === null ? null : Math.round(Number(value));
}

function toProcessingJob(row: Selectable<ProcessingJobs>): ProcessingJob {
  return {
    id: row.id,
    documentId: row.document_id,
    // CHECK constraints guarantee these values.
    status: row.status as ProcessingJobStatus,
    stage: row.stage as ProcessingStage | null,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    availableAt: row.available_at,
    lockedBy: row.locked_by,
    lockedAt: row.locked_at,
    leaseExpiresAt: row.lease_expires_at,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    requestId: row.request_id,
    textExtractionMs: row.text_extraction_ms,
    aiMs: row.ai_ms,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
