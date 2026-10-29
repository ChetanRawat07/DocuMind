import {
  ACTIVE_PROCESSING_JOB_STATUSES,
  type ProcessingJobStatus,
  type ProcessingStage,
} from '@documind/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';
import { DATABASE } from '../database/database.module.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import type { ProcessingJobs } from '../database/generated/database.js';

/** Bounds the enqueue retry loop; see enqueue(). Reaching it means heavy contention or a bug. */
const MAX_ENQUEUE_ATTEMPTS = 3;

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
 * Job persistence. Claiming, leases, retries and completion arrive in Phase 9;
 * this phase provides idempotent enqueueing on top of the schema's guarantees.
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
