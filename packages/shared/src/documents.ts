import { z } from 'zod';
import type { UploadMimeType } from './uploads.js';

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

/** Orders the document list supports. Every one pages with a keyset cursor. */
export const DOCUMENT_SORTS = [
  'newest',
  'oldest',
  'name_asc',
  'name_desc',
  'largest',
  'smallest',
] as const;
export type DocumentSort = (typeof DOCUMENT_SORTS)[number];
export const DEFAULT_DOCUMENT_SORT: DocumentSort = 'newest';

/** File formats the list can be filtered by, and the stored MIME types each covers. */
export const DOCUMENT_FORMATS = {
  pdf: ['application/pdf'],
  image: ['image/png', 'image/jpeg'],
} as const satisfies Record<string, readonly UploadMimeType[]>;
export type DocumentFormat = keyof typeof DOCUMENT_FORMATS;

/** Type filter value for documents that have not been classified yet. */
export const UNCLASSIFIED_DOCUMENT_TYPE = 'unclassified';

export const MAX_DOCUMENT_SEARCH_LENGTH = 100;

/**
 * Query string of `GET /documents`. The cursor is opaque: clients pass back
 * `nextCursor` unchanged, with the same sort. Filters combine with AND.
 * `q` matches part of the filename, ignoring case; a blank `q` is no filter.
 * It is normalized to NFC because stored filenames are.
 */
export const documentListQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_DOCUMENT_PAGE_SIZE)
    .default(DEFAULT_DOCUMENT_PAGE_SIZE),
  // Name cursors carry a filename: up to 255 characters, 4 UTF-8 bytes each, base64url-encoded.
  cursor: z.string().min(1).max(2000).optional(),
  q: z
    .string()
    .trim()
    .max(MAX_DOCUMENT_SEARCH_LENGTH)
    .optional()
    .transform((value) => (value ? value.normalize('NFC') : undefined)),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  type: z.enum([...DOCUMENT_TYPES, UNCLASSIFIED_DOCUMENT_TYPE]).optional(),
  format: z.enum(Object.keys(DOCUMENT_FORMATS) as [DocumentFormat, ...DocumentFormat[]]).optional(),
  sort: z.enum(DOCUMENT_SORTS).default(DEFAULT_DOCUMENT_SORT),
});
export type DocumentListQuery = z.output<typeof documentListQuerySchema>;

export const documentListResponseSchema = z.object({
  items: z.array(documentSchema),
  nextCursor: z.string().nullable(),
});
export type DocumentListResponse = z.infer<typeof documentListResponseSchema>;

export const DOCUMENT_CONTENT_DISPOSITIONS = ['inline', 'attachment'] as const;
export type DocumentContentDisposition = (typeof DOCUMENT_CONTENT_DISPOSITIONS)[number];

/**
 * Query string of `GET /documents/:id/content`: `inline` to display the file
 * (preview), `attachment` to save it (download).
 */
export const documentContentQuerySchema = z.object({
  disposition: z.enum(DOCUMENT_CONTENT_DISPOSITIONS).default('attachment'),
});
export type DocumentContentQuery = z.output<typeof documentContentQuerySchema>;
