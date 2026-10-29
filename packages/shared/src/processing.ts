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
