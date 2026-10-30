import {
  DEFAULT_DOCUMENT_SORT,
  type DocumentContentDisposition,
  type DocumentFormat,
  type DocumentListQuery,
  documentListQuerySchema,
  type DocumentSort,
  type DocumentStatus,
} from '@documind/shared';
import type { z } from 'zod';

/**
 * What the documents list shows: the search, filters and order, without
 * paging. An undefined filter means "all".
 */
export interface DocumentView {
  readonly q?: string | undefined;
  readonly status?: DocumentStatus | undefined;
  readonly type?: NonNullable<DocumentListQuery['type']> | undefined;
  readonly format?: DocumentFormat | undefined;
  readonly sort: DocumentSort;
}

export const DEFAULT_DOCUMENT_VIEW: DocumentView = { sort: DEFAULT_DOCUMENT_SORT };

const FILTER_KEYS = ['q', 'status', 'type', 'format'] as const;
const { shape } = documentListQuerySchema;

/**
 * Reads the view from the page URL. Each parameter is checked against the
 * API contract on its own, so one stale or hand-edited value is dropped
 * instead of breaking the whole page.
 */
export function documentViewFromParams(params: URLSearchParams): DocumentView {
  const read = (key: keyof DocumentView) => params.get(key) ?? undefined;
  const q = valueOf(shape.q.safeParse(read('q')));
  const status = valueOf(shape.status.safeParse(read('status')));
  const type = valueOf(shape.type.safeParse(read('type')));
  const format = valueOf(shape.format.safeParse(read('format')));
  return {
    sort: valueOf(shape.sort.safeParse(read('sort'))) ?? DEFAULT_DOCUMENT_SORT,
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
    ...(format ? { format } : {}),
  };
}

function valueOf<T>(result: z.ZodSafeParseResult<T>): T | undefined {
  return result.success ? result.data : undefined;
}

/** URL parameters for a view; defaults are left out to keep links short. */
export function documentViewToParams(view: DocumentView): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = view[key];
    if (value) params.set(key, value);
  }
  if (view.sort !== DEFAULT_DOCUMENT_SORT) params.set('sort', view.sort);
  return params;
}

/** True when a search or filter narrows the list (the order does not count). */
export function hasDocumentFilters(view: DocumentView): boolean {
  return FILTER_KEYS.some((key) => view[key] !== undefined);
}

/** True for the plain newest-first list, where a new upload belongs at the top. */
export function isDefaultDocumentView(view: DocumentView): boolean {
  return !hasDocumentFilters(view) && view.sort === DEFAULT_DOCUMENT_SORT;
}

/** API path of one page of the list. */
export function documentListPath(view: DocumentView, limit: number, cursor?: string): string {
  const params = documentViewToParams(view);
  params.set('limit', String(limit));
  if (cursor) params.set('cursor', cursor);
  return `/documents?${params.toString()}`;
}

/** Route of a document's detail page. */
export function documentDetailPath(id: string): string {
  return `/documents/${encodeURIComponent(id)}`;
}

/** API path of a document's file: `inline` to preview it, `attachment` to download it. */
export function documentContentPath(id: string, disposition: DocumentContentDisposition): string {
  return `/documents/${encodeURIComponent(id)}/content?disposition=${disposition}`;
}
