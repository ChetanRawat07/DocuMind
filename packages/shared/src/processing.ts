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
  /** The API request that queued the job, for matching it to logs. */
  requestId: z.string().nullable(),
  /** How long each step took in the attempt that last ran it. */
  textExtractionMs: z.number().int().nonnegative().nullable(),
  aiMs: z.number().int().nonnegative().nullable(),
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

export const DEFAULT_PROCESSING_JOB_PAGE_SIZE = 50;
export const MAX_PROCESSING_JOB_PAGE_SIZE = 100;

/** `GET /processing/jobs`: the user's most recent jobs, optionally of one status. */
export const processingJobQuerySchema = z.object({
  status: z.enum(PROCESSING_JOB_STATUSES).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PROCESSING_JOB_PAGE_SIZE)
    .default(DEFAULT_PROCESSING_JOB_PAGE_SIZE),
});
export type ProcessingJobQuery = z.infer<typeof processingJobQuerySchema>;

export const ownedProcessingJobSchema = processingJobSchema.extend({
  document: z.object({ id: z.uuid(), originalFilename: z.string() }),
});
export type OwnedProcessingJobDto = z.infer<typeof ownedProcessingJobSchema>;

export const ownedProcessingJobListResponseSchema = z.object({
  items: z.array(ownedProcessingJobSchema),
});
export type OwnedProcessingJobListResponse = z.infer<typeof ownedProcessingJobListResponseSchema>;

/** Jobs that finished within this many days count towards the summary's totals and durations. */
export const PROCESSING_SUMMARY_WINDOW_DAYS = 7;

const durationStatsSchema = z.object({
  average: z.number().int().nonnegative().nullable(),
  p95: z.number().int().nonnegative().nullable(),
});

/**
 * `GET /processing/summary`, over the user's documents: the queue now, and
 * the jobs that finished in the last `windowDays`. Durations are in
 * milliseconds: `processingMs` from first start to finish of succeeded jobs
 * (retries included), and the text extraction (OCR) and AI steps.
 */
export const processingSummarySchema = z.object({
  windowDays: z.number().int().positive(),
  queued: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  oldestQueuedAt: z.iso.datetime().nullable(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  failuresByCode: z.array(z.object({ code: z.string(), count: z.number().int().positive() })),
  processingMs: durationStatsSchema,
  textExtractionMs: durationStatsSchema,
  aiMs: durationStatsSchema,
});
export type ProcessingSummary = z.infer<typeof processingSummarySchema>;
