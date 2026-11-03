import type { AuditLogEntryDto, ProcessingJobStatus } from '@documind/shared';
import type { StatusTone } from './document-labels';
import { fieldLabel } from './extraction-labels';
import { formatDuration, formatPercent } from './format';

/** Audit actions as people read them. An action missing here shows its code. */
const ACTION_LABEL: Readonly<Record<string, string>> = {
  'user.registered': 'Account created',
  'user.data_erased': 'All data deleted',
  'document.uploaded': 'Uploaded',
  'document.deleted': 'Deleted',
  'document.viewed': 'Previewed',
  'document.downloaded': 'Downloaded',
  'document.processing_requested': 'Reprocessing requested',
  'document.text_extracted': 'Text extracted',
  'document.fields_extracted': 'Fields extracted',
  'document.processing_failed': 'Processing failed',
  'document.field_reviewed': 'Field reviewed',
  'document.approved': 'Approved',
  'document.rejected': 'Rejected',
};

export function auditActionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

/** Why a job failed, from its error code. A code missing here shows the code itself. */
const JOB_ERROR_LABEL: Readonly<Record<string, string>> = {
  ocr_failed: 'OCR failed',
  unreadable_pdf: 'Unreadable PDF',
  encrypted_pdf: 'Password-protected PDF',
  too_many_pages: 'Too many pages',
  unreadable_image: 'Unreadable image',
  image_too_large: 'Image too large',
  unsupported_type: 'Unsupported file type',
  page_text_too_long: 'Page text too long',
  no_text: 'No text found',
  ai_timeout: 'AI timed out',
  ai_rate_limited: 'AI rate limited',
  ai_unavailable: 'AI service unavailable',
  ai_invalid_output: 'AI answer was invalid',
  ai_authentication: 'AI credentials rejected',
  ai_invalid_request: 'AI request rejected',
  unsupported_document_type: 'Not an invoice, purchase order or contract',
  file_missing: 'File missing from storage',
  lease_expired: 'Worker stopped during processing',
  internal_error: 'Internal error',
};

export function jobErrorLabel(code: string): string {
  return JOB_ERROR_LABEL[code] ?? code;
}

export const JOB_STATUS_DISPLAY: Record<ProcessingJobStatus, { label: string; tone: StatusTone }> =
  {
    queued: { label: 'Queued', tone: 'neutral' },
    running: { label: 'Running', tone: 'info' },
    succeeded: { label: 'Succeeded', tone: 'success' },
    failed: { label: 'Failed', tone: 'danger' },
  };

const count = (value: unknown, one: string, many: string): string | null =>
  typeof value === 'number' ? `${String(value)} ${value === 1 ? one : many}` : null;

/**
 * One line of detail for an entry, from its metadata: page counts, scores,
 * field names, error codes. Metadata never holds document content.
 */
export function describeAuditEntry(entry: Pick<AuditLogEntryDto, 'action' | 'metadata'>): string {
  const m = entry.metadata;
  const parts: (string | null)[] = [];
  switch (entry.action) {
    case 'document.text_extracted':
      parts.push(
        count(m.pageCount, 'page', 'pages'),
        typeof m.ocrPageCount === 'number' && m.ocrPageCount > 0
          ? `${String(m.ocrPageCount)} by OCR`
          : null,
        typeof m.durationMs === 'number' ? formatDuration(m.durationMs) : null,
      );
      break;
    case 'document.fields_extracted':
      parts.push(
        typeof m.overallConfidence === 'number'
          ? `Confidence ${formatPercent(m.overallConfidence)}`
          : null,
        count(Array.isArray(m.issues) ? m.issues.length : null, 'issue', 'issues'),
      );
      break;
    case 'document.processing_failed':
      parts.push(
        typeof m.errorCode === 'string' ? jobErrorLabel(m.errorCode) : null,
        count(m.attempts, 'attempt', 'attempts'),
      );
      break;
    case 'document.field_reviewed':
      parts.push(
        typeof m.field === 'string'
          ? `${fieldLabel(m.field)} ${m.action === 'corrected' ? 'corrected' : 'confirmed'}`
          : null,
      );
      break;
    case 'document.approved':
      parts.push(
        m.automatic === true
          ? 'Automatically, every value passed its checks'
          : count(
              Array.isArray(m.correctedFields) ? m.correctedFields.length : null,
              'field corrected',
              'fields corrected',
            ),
      );
      break;
  }
  return parts.filter((part) => part !== null).join(' · ');
}
