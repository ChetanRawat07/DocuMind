/**
 * User-facing document lifecycle. Fine-grained pipeline progress lives on the
 * processing job (see processing.ts), not here.
 */
export const DOCUMENT_STATUSES = [
  'uploaded',
  'queued',
  'processing',
  'needs_review',
  'completed',
  'failed',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** Statuses in which processing has reached an outcome (`processed_at` is set). */
export const PROCESSED_DOCUMENT_STATUSES = [
  'needs_review',
  'completed',
  'failed',
] as const satisfies readonly DocumentStatus[];

export const DOCUMENT_TYPES = ['invoice', 'contract', 'purchase_order'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
