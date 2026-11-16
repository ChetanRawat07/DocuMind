import {
  analyticsSchema,
  auditLogListResponseSchema,
  DEFAULT_ANALYTICS_RANGE,
  DEFAULT_AUDIT_LOG_PAGE_SIZE,
  documentListResponseSchema,
  processingSummarySchema,
} from '@documind/shared';
import type { z } from 'zod';
import { NAV_ITEMS } from '../layout/navigation';
import { analyticsPath } from '../lib/analytics-view';
import { DEFAULT_DOCUMENT_VIEW, type DocumentView, documentListPath } from '../lib/document-view';

/** The dashboard's window; the Analytics page offers the others. */
export const DASHBOARD_RANGE = 30;
export const DOCUMENTS_PAGE_SIZE = 20;
export const REVIEW_PAGE_SIZE = 20;
/** Oldest first: whatever has waited longest is reviewed next. */
export const REVIEW_QUEUE: DocumentView = { status: 'needs_review', sort: 'oldest' };
export const PROCESSING_SUMMARY_PATH = '/processing/summary';
export const AUDIT_LOG_FIRST_PAGE_PATH = `/audit-logs?limit=${String(DEFAULT_AUDIT_LOG_PAGE_SIZE)}`;

export interface PageQuery {
  readonly path: string;
  readonly schema: z.ZodType;
}

/**
 * The main API request of the page at `route` (a sidebar path), which the
 * sidebar prefetches when its link is pointed at or focused. Each page builds
 * its request from the same constants, so both use the same cache entry.
 */
export function pageQuery(route: string): PageQuery | undefined {
  switch (route) {
    case NAV_ITEMS.dashboard.path:
      return { path: analyticsPath(DASHBOARD_RANGE), schema: analyticsSchema };
    case NAV_ITEMS.documents.path:
      return {
        path: documentListPath(DEFAULT_DOCUMENT_VIEW, DOCUMENTS_PAGE_SIZE),
        schema: documentListResponseSchema,
      };
    case NAV_ITEMS.processing.path:
      return { path: PROCESSING_SUMMARY_PATH, schema: processingSummarySchema };
    case NAV_ITEMS.review.path:
      return {
        path: documentListPath(REVIEW_QUEUE, REVIEW_PAGE_SIZE),
        schema: documentListResponseSchema,
      };
    case NAV_ITEMS.analytics.path:
      return { path: analyticsPath(DEFAULT_ANALYTICS_RANGE), schema: analyticsSchema };
    case NAV_ITEMS.auditLogs.path:
      return { path: AUDIT_LOG_FIRST_PAGE_PATH, schema: auditLogListResponseSchema };
    default:
      return undefined;
  }
}
