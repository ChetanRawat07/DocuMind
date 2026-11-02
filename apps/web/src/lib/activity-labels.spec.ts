import { describe, expect, it } from 'vitest';
import { auditActionLabel, describeAuditEntry, jobErrorLabel } from './activity-labels';

describe('describeAuditEntry', () => {
  it.each([
    [
      'document.text_extracted',
      { pageCount: 1, ocrPageCount: 0, durationMs: 850 },
      '1 page · 850 ms',
    ],
    [
      'document.fields_extracted',
      { overallConfidence: 0.72, issues: ['date_order'] },
      'Confidence 72% · 1 issue',
    ],
    [
      'document.processing_failed',
      { errorCode: 'ai_timeout', attempts: 3 },
      'AI timed out · 3 attempts',
    ],
    ['document.field_reviewed', { field: 'totalAmount', action: 'corrected' }, 'Total corrected'],
    ['document.approved', { automatic: true }, 'Automatically, every value passed its checks'],
    ['document.approved', { correctedFields: ['a', 'b'] }, '2 fields corrected'],
    ['document.uploaded', { mimeType: 'application/pdf' }, ''],
  ])('%s %j reads "%s"', (action, metadata, expected) => {
    expect(describeAuditEntry({ action, metadata })).toBe(expected);
  });

  it('ignores metadata of an unexpected shape', () => {
    expect(
      describeAuditEntry({ action: 'document.text_extracted', metadata: { pageCount: '3' } }),
    ).toBe('');
  });
});

describe('labels', () => {
  it('fall back to the code for unknown actions and errors', () => {
    expect(auditActionLabel('document.archived')).toBe('document.archived');
    expect(jobErrorLabel('new_code')).toBe('new_code');
    expect(jobErrorLabel('lease_expired')).toBe('Worker stopped during processing');
  });
});
