import {
  type OwnedProcessingJobListResponse,
  PROCESSING_SUMMARY_WINDOW_DAYS,
  type ProcessingJobQuery,
  processingJobQuerySchema,
  type ProcessingSummary,
} from '@documind/shared';
import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { toProcessingJobDto } from '../documents/documents.controller.js';
import { ProcessingJobsRepository } from '../jobs/processing-jobs.repository.js';
import type { User } from '../users/users.repository.js';

/**
 * Operational data for the Processing screen, always limited to the signed-in
 * user's documents: their jobs, and counts and durations over a recent window.
 */
@Controller('processing')
export class ProcessingController {
  constructor(private readonly jobs: ProcessingJobsRepository) {}

  @Get('summary')
  async summary(@CurrentUser() user: User): Promise<ProcessingSummary> {
    const summary = await this.jobs.summaryForOwner(user.id, PROCESSING_SUMMARY_WINDOW_DAYS);
    return {
      ...summary,
      windowDays: PROCESSING_SUMMARY_WINDOW_DAYS,
      oldestQueuedAt: summary.oldestQueuedAt?.toISOString() ?? null,
      failuresByCode: [...summary.failuresByCode],
    };
  }

  @Get('jobs')
  async list(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(processingJobQuerySchema)) query: ProcessingJobQuery,
  ): Promise<OwnedProcessingJobListResponse> {
    const jobs = await this.jobs.listForOwner(user.id, query);
    return {
      items: jobs.map((job) => ({
        ...toProcessingJobDto(job),
        document: { id: job.documentId, originalFilename: job.documentFilename },
      })),
    };
  }
}
