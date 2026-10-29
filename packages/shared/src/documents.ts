import { z } from 'zod';

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

export const DEFAULT_DOCUMENT_PAGE_SIZE = 20;
export const MAX_DOCUMENT_PAGE_SIZE = 100;

/** A document as returned by the API. Internal fields such as the storage key are never exposed. */
export const documentSchema = z.object({
  id: z.uuid(),
  originalFilename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().positive(),
  documentType: z.enum(DOCUMENT_TYPES).nullable(),
  status: z.enum(DOCUMENT_STATUSES),
  processedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type DocumentDto = z.infer<typeof documentSchema>;

/** Query string of `GET /documents`. The cursor is opaque: clients pass back `nextCursor` unchanged. */
export const documentListQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_DOCUMENT_PAGE_SIZE)
    .default(DEFAULT_DOCUMENT_PAGE_SIZE),
  cursor: z.string().min(1).max(200).optional(),
});
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;

export const documentListResponseSchema = z.object({
  items: z.array(documentSchema),
  nextCursor: z.string().nullable(),
});
export type DocumentListResponse = z.infer<typeof documentListResponseSchema>;
