import { z } from 'zod';

/** Queue-level state of a processing job. */
export const PROCESSING_JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;
export type ProcessingJobStatus = (typeof PROCESSING_JOB_STATUSES)[number];

/** Statuses of a job that still owns its document; at most one such job exists per document. */
export const ACTIVE_PROCESSING_JOB_STATUSES = [
  'queued',
  'running',
] as const satisfies readonly ProcessingJobStatus[];

/** Pipeline step a running job is in, for progress display. */
export const PROCESSING_STAGES = [
  'text_extraction',
  'ocr',
  'classification',
  'ai_extraction',
  'validation',
  'confidence_evaluation',
] as const;
export type ProcessingStage = (typeof PROCESSING_STAGES)[number];

/**
 * A processing job as returned by the API. `errorCode` is the last failure's
 * code (for example `ai_timeout` or `encrypted_pdf`); the stored message stays
 * internal. While queued, `availableAt` is when the job may next run, so a
 * scheduled retry shows when it will happen.
 */
export const processingJobSchema = z.object({
  id: z.uuid(),
  status: z.enum(PROCESSING_JOB_STATUSES),
  stage: z.enum(PROCESSING_STAGES).nullable(),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  errorCode: z.string().nullable(),
  availableAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ProcessingJobDto = z.infer<typeof processingJobSchema>;

/** `GET /documents/:id/jobs`: the document's most recent jobs, newest first. */
export const processingJobListResponseSchema = z.object({
  items: z.array(processingJobSchema),
});
export type ProcessingJobListResponse = z.infer<typeof processingJobListResponseSchema>;
