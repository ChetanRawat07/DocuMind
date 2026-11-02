import {
  ACTIVE_PROCESSING_JOB_STATUSES,
  type ProcessingJobStatus,
  type ProcessingStage,
} from '@documind/shared';
import { Inject, Injectable } from '@nestjs/common';
import { type ExpressionBuilder, type Selectable, sql, type UpdateObject } from 'kysely';
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
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
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
        .values({ document_id: documentId })
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
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
