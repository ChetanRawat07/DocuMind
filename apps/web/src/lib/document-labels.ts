import {
  type DocumentFormat,
  type DocumentSort,
  type DocumentStatus,
  type DocumentType,
  UPLOAD_FILE_TYPES,
} from '@documind/shared';

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

export const DOCUMENT_SORT_LABEL: Record<DocumentSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  name_asc: 'Name, A to Z',
  name_desc: 'Name, Z to A',
  largest: 'Largest first',
  smallest: 'Smallest first',
};

export const DOCUMENT_FORMAT_LABEL: Record<DocumentFormat, string> = {
  pdf: 'PDF',
  image: 'Image (PNG, JPEG)',
};

/** "PDF", "PNG", "JPEG" for the stored MIME type; the type itself if it is not an upload type. */
export function fileTypeLabel(mimeType: string): string {
  return UPLOAD_FILE_TYPES.find((type) => type.mimeType === mimeType)?.label ?? mimeType;
}
