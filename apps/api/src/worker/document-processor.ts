import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditLogsRepository } from '../audit/audit-logs.repository.js';
import type { AppConfig } from '../config/app-config.js';
import { APP_CONFIG } from '../config/app-config.module.js';
import { DATABASE } from '../database/database.module.js';
import type { DatabaseExecutor } from '../database/database.types.js';
import { DocumentsRepository } from '../documents/documents.repository.js';
import {
  DocumentAnalysisService,
  type ExtractedAnalysis,
} from '../extraction/document-analysis.service.js';
import {
  type ProcessingJob,
  ProcessingJobsRepository,
} from '../jobs/processing-jobs.repository.js';
import { DocumentTextsRepository } from '../text-extraction/document-texts.repository.js';
import { TextExtractionService } from '../text-extraction/text-extraction.service.js';
import {
  classifyFailure,
  type JobFailure,
  retryDelayMs,
  UNSUPPORTED_DOCUMENT,
} from './job-failure.js';

/**
 * How long a claim lasts. It must outlast the slowest possible run, or a
 * healthy job would be taken over: two AI calls, each bounded by the AI
 * timeout, plus a margin for text extraction and OCR. There is no heartbeat
 * (ADR-008), so this is also how long a crashed worker's job waits.
 */
export function leaseDurationMs(aiTimeoutMs: number): number {
  return 2 * aiTimeoutMs + 5 * 60_000;
}

/**
 * Runs one processing job at a time: text extraction, then classification
 * and field extraction. Delivery is at-least-once, and every step is safe to
 * repeat (docs/processing/job-queue.md):
 *
 * - Text extraction is skipped when the document's text already exists.
 * - The extraction is saved, the job marked succeeded and the document moved
 *   to review in one transaction, fenced by the job's claim. A worker that
 *   lost its claim therefore saves nothing; AI calls may repeat, results not.
 */
@Injectable()
export class DocumentProcessor {
  private readonly logger = new Logger(DocumentProcessor.name);
  /** Unique per process, so a restarted worker never matches its predecessor's claims. */
  readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private readonly leaseMs: number;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(DATABASE) private readonly db: DatabaseExecutor,
    private readonly jobs: ProcessingJobsRepository,
    private readonly documents: DocumentsRepository,
    private readonly texts: DocumentTextsRepository,
    private readonly textExtraction: TextExtractionService,
    private readonly analysis: DocumentAnalysisService,
    private readonly auditLogs: AuditLogsRepository,
  ) {
    this.leaseMs = leaseDurationMs(config.ai.timeoutMs);
  }

  /** Releases expired claims, then processes the next due job. Resolves true when there was one. */
  async runNext(): Promise<boolean> {
    await this.releaseExpiredJobs();
    const job = await this.claim();
    if (!job) return false;
    await this.process(job);
    return true;
  }

  private async claim(): Promise<ProcessingJob | null> {
    return this.db.transaction().execute(async (trx) => {
      const job = await this.jobs.claimNext(this.workerId, this.leaseMs, trx);
      if (job) await this.documents.setStatus(job.documentId, 'processing', trx);
      return job;
    });
  }

  private async process(job: ProcessingJob): Promise<void> {
    this.logger.log(`Job ${job.id} attempt ${job.attempts}/${job.maxAttempts} started`);
    try {
      await this.jobs.setStage(job, 'text_extraction');
      // The file never changes, so text from an earlier attempt is reused.
      if (!(await this.texts.findForDocument(job.documentId))) {
        // null: the document was deleted, and its job with it.
        if (!(await this.textExtraction.extract(job.documentId))) return;
      }

      await this.jobs.setStage(job, 'ai_extraction');
      const analysis = await this.analysis.analyze(job.documentId);
      if (!analysis) return;
      if (analysis.outcome === 'unsupported') {
        await this.fail(job, UNSUPPORTED_DOCUMENT);
        return;
      }
      await this.succeed(job, analysis);
    } catch (error) {
      const failure = classifyFailure(error);
      if (failure.code === 'internal_error') {
        this.logger.error(
          `Job ${job.id}: ${error instanceof Error ? error.message : 'Non-error value thrown'}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
      await this.fail(job, failure);
    }
  }

  /** Every extraction goes to review; Phase 10 decides which may complete on their own. */
  private async succeed(job: ProcessingJob, analysis: ExtractedAnalysis): Promise<void> {
    const finished = await this.db.transaction().execute(async (trx) => {
      // First, so the job row is locked and still ours before anything is saved.
      if (!(await this.jobs.markSucceeded(job, trx))) return false;
      await this.analysis.save(job.id, analysis, trx);
      await this.documents.setStatus(job.documentId, 'needs_review', trx);
      return true;
    });
    if (finished) {
      this.logger.log(`Job ${job.id} succeeded`);
    } else {
      this.logger.warn(`Job ${job.id}: claim lost before finishing; result discarded`);
    }
  }

  /** Retries with backoff while attempts remain and a retry can help; otherwise dead-letters the job. */
  private async fail(job: ProcessingJob, failure: JobFailure): Promise<void> {
    const retryAt =
      failure.retryable && job.attempts < job.maxAttempts
        ? new Date(Date.now() + retryDelayMs(job.attempts, failure.retryAfterMs))
        : null;
    const recorded = await this.db.transaction().execute(async (trx) => {
      if (retryAt) {
        if (!(await this.jobs.scheduleRetry(job, failure, retryAt, trx))) return false;
        await this.documents.setStatus(job.documentId, 'queued', trx);
      } else {
        if (!(await this.jobs.markFailed(job, failure, trx))) return false;
        await this.recordFailedDocument(job, failure.code, trx);
      }
      return true;
    });
    if (!recorded) {
      this.logger.warn(`Job ${job.id}: claim lost before recording failure ${failure.code}`);
    } else if (retryAt) {
      this.logger.warn(
        `Job ${job.id} attempt ${job.attempts}/${job.maxAttempts} failed (${failure.code}); retry at ${retryAt.toISOString()}`,
      );
    } else {
      this.logger.warn(
        `Job ${job.id} failed (${failure.code}) on attempt ${job.attempts}/${job.maxAttempts}; not retried`,
      );
    }
  }

  /** Requeues or fails jobs whose worker crashed or hung past its lease. */
  private async releaseExpiredJobs(): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      for (const job of await this.jobs.releaseExpired(trx)) {
        this.logger.warn(
          `Job ${job.id}: lease expired after attempt ${job.attempts}; ${job.status}`,
        );
        if (job.status === 'failed') {
          await this.recordFailedDocument(job, 'lease_expired', trx);
        } else {
          await this.documents.setStatus(job.documentId, 'queued', trx);
        }
      }
    });
  }

  private async recordFailedDocument(
    job: ProcessingJob,
    errorCode: string,
    trx: DatabaseExecutor,
  ): Promise<void> {
    await this.documents.setStatus(job.documentId, 'failed', trx);
    await this.auditLogs.append(
      {
        actor: { type: 'system' },
        action: 'document.processing_failed',
        resourceType: 'document',
        resourceId: job.documentId,
        requestId: null,
        metadata: { jobId: job.id, errorCode, attempts: job.attempts },
      },
      trx,
    );
  }
}
