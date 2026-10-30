import type { DocumentStatus, DocumentType } from '@documind/shared';

export type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

/** Display text and tone for each document status. `Record` makes a new status a compile error here. */
export const DOCUMENT_STATUS_DISPLAY: Record<DocumentStatus, { label: string; tone: StatusTone }> =
  {
    uploaded: { label: 'Uploaded', tone: 'neutral' },
    queued: { label: 'Queued', tone: 'neutral' },
    processing: { label: 'Processing', tone: 'info' },
    needs_review: { label: 'Needs review', tone: 'warning' },
    completed: { label: 'Complete', tone: 'success' },
    failed: { label: 'Failed', tone: 'danger' },
  };

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  invoice: 'Invoice',
  contract: 'Contract',
  purchase_order: 'Purchase order',
};
