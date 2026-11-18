import {
  type DocumentDto,
  type DocumentExtractionDto,
  documentExtractionSchema,
  documentSchema,
  type ExtractedFieldDto,
  MAX_REJECT_REASON_LENGTH,
  REVIEW_CONFIDENCE_THRESHOLD,
} from '@documind/shared';
import { CircleCheck, CircleX, FileSearch, TriangleAlert } from 'lucide-react';
import { type KeyboardEvent, useId, useState } from 'react';
import { cx } from '../../lib/cx';
import { useDelayedLoading } from '../../lib/delayed-loading';
import { DOCUMENT_TYPE_LABEL } from '../../lib/document-labels';
import { ISSUE_LABEL } from '../../lib/extraction-labels';
import { formatDateTime, formatPercent } from '../../lib/format';
import { ApiError, SessionExpiredError } from '../../services/api-client';
import { useApi } from '../../services/use-api';
import { invalidateDocumentData, useApiQuery } from '../../services/use-api-query';
import { INPUT_CLASS } from '../form-controls';
import { Button } from '../ui/button';
import { SEGMENTED_GROUP, segmentClasses } from '../ui/button-styles';
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '../ui/feedback';
import { type FieldAction, FieldRow } from './field-row';

/** Statuses in which the document has an extraction to show. */
const HAS_EXTRACTION: ReadonlySet<DocumentDto['status']> = new Set([
  'needs_review',
  'completed',
  'rejected',
]);

const INVALID_VALUE: Record<ExtractedFieldDto['kind'], string> = {
  text: 'Enter at most 300 characters.',
  date: 'Enter a valid date.',
  amount: 'Enter a number.',
  currency: 'Enter a three-letter currency code, such as USD.',
  list: 'Lists can be confirmed, not edited.',
};
const CHANGED = 'This document changed elsewhere. The latest data is shown now.';
const SAVE_FAILED = 'Could not save. Check your connection and try again.';

function NotYet({ status }: { status: DocumentDto['status'] }) {
  return (
    <EmptyState
      icon={FileSearch}
      title={status === 'failed' ? 'Nothing extracted' : 'No extracted data yet'}
      description={
        status === 'failed'
          ? 'Processing failed before any fields were read. Reprocess the document to try again.'
          : 'Fields read from this document will appear here once processing finishes.'
      }
    />
  );
}

function DecisionNote({ extraction }: { extraction: DocumentExtractionDto }) {
  const { decision, decidedBy, decidedAt, rejectReason } = extraction.review;
  if (!decision || !decidedAt) return null;
  const when = formatDateTime(decidedAt);
  if (decision === 'approved') {
    return (
      <p className="flex gap-2 border-b border-line-subtle bg-success-subtle px-4 py-3 sm:px-6 text-compact text-success-fg">
        <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {decidedBy === 'system'
          ? `Approved automatically on ${when}: every value was found in the document and passed its checks.`
          : `Approved on ${when}.`}
      </p>
    );
  }
  return (
    <div className="border-b border-line-subtle bg-danger-subtle px-4 py-3 sm:px-6 text-compact text-danger-fg">
      <p className="flex gap-2">
        <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        Rejected on {when}. Reprocess the document to extract it again.
      </p>
      {rejectReason ? <p className="mt-1 text-fg-secondary">Reason: {rejectReason}</p> : null}
    </div>
  );
}

/**
 * Approve once every flagged field is checked, or reject with an optional
 * reason. The API enforces the same rule; the button only mirrors it.
 */
function DecisionBar({
  flagged,
  remaining,
  onApprove,
  onReject,
}: {
  flagged: number;
  remaining: number;
  onApprove: () => Promise<string | null>;
  onReject: (reason: string) => Promise<string | null>;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hintId = useId();
  const reasonId = useId();

  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    const message = await action();
    // On success the panel reloads and this bar unmounts.
    setBusy(false);
    setError(message);
  }

  if (rejecting) {
    return (
      <div className="sticky bottom-0 z-10 space-y-2 border-t border-line bg-surface-subtle px-4 py-3 sm:px-6">
        <label htmlFor={reasonId} className="block text-compact font-medium text-fg">
          Why is this extraction unusable? (optional)
        </label>
        <textarea
          id={reasonId}
          rows={2}
          maxLength={MAX_REJECT_REASON_LENGTH}
          value={reason}
          autoFocus
          onChange={(event) => {
            setReason(event.target.value);
          }}
          className={`${INPUT_CLASS} px-3 py-2`}
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="danger"
            loading={busy}
            onClick={() => void run(() => onReject(reason))}
          >
            {busy ? 'Rejecting…' : 'Reject extraction'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => {
              setRejecting(false);
              setError(null);
            }}
          >
            Cancel
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-xs text-danger-fg">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="sticky bottom-0 z-10 space-y-2 border-t border-line bg-surface-subtle px-4 py-3 sm:px-6">
      <p id={hintId} className="text-xs text-fg-secondary">
        {remaining > 0
          ? `Confirm or correct ${String(remaining)} more flagged ${remaining === 1 ? 'field' : 'fields'} to approve.`
          : 'Every flagged field is checked. Approving makes these values final.'}
      </p>
      {flagged > 0 ? (
        <span
          aria-hidden="true"
          className="block h-1 overflow-hidden rounded-full bg-surface-muted"
        >
          <span
            className="block h-full rounded-full bg-accent transition-[width] duration-150"
            style={{ width: `${String(Math.round(((flagged - remaining) / flagged) * 100))}%` }}
          />
        </span>
      ) : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          loading={busy}
          disabled={remaining > 0}
          aria-describedby={hintId}
          onClick={() => void run(onApprove)}
        >
          {busy ? 'Approving…' : 'Approve'}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => {
            setRejecting(true);
          }}
        >
          Reject
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Review keys on the field list: J and K move between fields, Enter confirms
 * and E edits the focused one. Typing in a field or a button's own Enter is
 * left alone.
 */
function handleFieldKeys(event: KeyboardEvent<HTMLUListElement>) {
  const target = event.target as HTMLElement;
  if (event.altKey || event.ctrlKey || event.metaKey || target.closest('input, textarea, form')) {
    return;
  }
  const rows = [...event.currentTarget.children] as HTMLElement[];
  const row = target.closest('li');
  const key = event.key.toLowerCase();
  if (key === 'j' || key === 'k') {
    event.preventDefault();
    const index = row ? rows.indexOf(row) : -1;
    const next = Math.min(Math.max(index + (key === 'j' ? 1 : -1), 0), rows.length - 1);
    rows[next]?.focus();
  } else if (row && target === row && (key === 'enter' || key === 'e')) {
    const action = key === 'e' ? 'edit' : 'confirm';
    const button = row.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`);
    if (button && !button.disabled) {
      event.preventDefault();
      button.click();
    }
  }
}

/**
 * The document's extracted fields and their review. Confidence is shown as a
 * review signal: flagged fields come with the reason and the quoted passage.
 */
export function ExtractionPanel({
  document,
  onDocumentChange,
}: {
  document: DocumentDto;
  onDocumentChange: (document: DocumentDto) => void;
}) {
  if (!HAS_EXTRACTION.has(document.status)) return <NotYet status={document.status} />;
  return <LoadedExtraction document={document} onDocumentChange={onDocumentChange} />;
}

/** The type and confidence strip over a few field rows, as the loaded panel starts. */
export function ExtractionSkeleton({ className }: { className?: string | undefined }) {
  return (
    <div className={className}>
      <div className="flex h-[45px] items-center justify-between border-b border-line-subtle px-4 sm:px-6">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-28" />
      </div>
      <SkeletonRows label="Loading extracted data…" rows={4} header={false} />
    </div>
  );
}

function LoadedExtraction({
  document,
  onDocumentChange,
}: {
  document: DocumentDto;
  onDocumentChange: (document: DocumentDto) => void;
}) {
  const api = useApi();
  const path = `/documents/${encodeURIComponent(document.id)}/extraction`;
  const result = useApiQuery(path, documentExtractionSchema);
  // A saved field returns the whole extraction; it replaces the loaded one until the next load.
  const [saved, setSaved] = useState<DocumentExtractionDto | null>(null);
  const [showJson, setShowJson] = useState(false);

  const load = useDelayedLoading(result.status === 'loading');

  if (load.skeleton || result.status === 'loading') {
    return <ExtractionSkeleton className={load.skeletonClass} />;
  }
  if (result.status === 'error') {
    return (
      <ErrorState
        title="Could not load the extracted data"
        description="Check your connection and try again."
        onRetry={result.retry}
        error={result.error}
      />
    );
  }

  const extraction = saved?.id === result.data.id ? saved : result.data;
  const editable = document.status === 'needs_review' && extraction.review.decision === null;
  const currency = extraction.fields.find((field) => field.name === 'currency')?.value;
  const remaining = extraction.fields.filter((field) => field.needsReview && !field.reviewed);
  const documentIssues = extraction.issues.filter((issue) => issue.fields.length === 0);
  // Forgets cached document data first, so the reload shows loading rather than the old extraction.
  const reload = () => {
    invalidateDocumentData();
    setSaved(null);
    result.retry();
  };

  /** Turns a failed request into the message to show; reloads when the data changed elsewhere. */
  function failure(error: unknown, invalid: string): string | null {
    if (error instanceof SessionExpiredError) return null;
    if (error instanceof ApiError && error.status === 400) return invalid;
    if (error instanceof ApiError && (error.status === 409 || error.status === 404)) {
      reload();
      return CHANGED;
    }
    return SAVE_FAILED;
  }

  async function reviewField(name: string, action: FieldAction): Promise<string | null> {
    const kind = extraction.fields.find((field) => field.name === name)?.kind ?? 'text';
    try {
      setSaved(
        await api.send(
          'PUT',
          `${path}/fields/${encodeURIComponent(name)}`,
          { extractionId: extraction.id, ...action },
          documentExtractionSchema,
        ),
      );
      invalidateDocumentData();
      return null;
    } catch (error) {
      return failure(error, INVALID_VALUE[kind]);
    }
  }

  async function decide(decision: 'approve' | 'reject', body: object): Promise<string | null> {
    try {
      const updated = await api.send(
        'POST',
        `${path}/${decision}`,
        { extractionId: extraction.id, ...body },
        documentSchema,
      );
      reload();
      onDocumentChange(updated);
      return null;
    } catch (error) {
      return failure(error, SAVE_FAILED);
    }
  }

  return (
    <div className={load.revealClass}>
      <div className="flex items-center justify-between gap-3 border-b border-line-subtle px-4 py-3 sm:px-6">
        <p className="text-compact text-fg-secondary">
          {DOCUMENT_TYPE_LABEL[extraction.documentType]}
          {extraction.classificationConfidence < REVIEW_CONFIDENCE_THRESHOLD ? (
            <span className="text-warning-fg"> (type uncertain)</span>
          ) : null}
        </p>
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-2"
            title="The lowest score of any value: a review signal, not a probability."
          >
            <p className="text-compact font-medium text-fg tabular-nums">
              Confidence {formatPercent(extraction.overallConfidence)}
            </p>
            <span
              aria-hidden="true"
              className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-muted"
            >
              <span
                className={cx(
                  'block h-full rounded-full',
                  extraction.overallConfidence < REVIEW_CONFIDENCE_THRESHOLD
                    ? 'bg-warning-fg'
                    : 'bg-success-fg',
                )}
                style={{ width: `${String(Math.round(extraction.overallConfidence * 100))}%` }}
              />
            </span>
          </div>
          <div className={SEGMENTED_GROUP} role="group" aria-label="Show extracted data as">
            <button
              type="button"
              aria-pressed={!showJson}
              className={segmentClasses(!showJson)}
              onClick={() => {
                setShowJson(false);
              }}
            >
              Fields
            </button>
            <button
              type="button"
              aria-pressed={showJson}
              className={segmentClasses(showJson)}
              onClick={() => {
                setShowJson(true);
              }}
            >
              JSON
            </button>
          </div>
        </div>
      </div>
      <DecisionNote extraction={extraction} />
      {editable && extraction.classificationConfidence < REVIEW_CONFIDENCE_THRESHOLD ? (
        <p className="flex gap-2 border-b border-line-subtle bg-warning-subtle px-4 py-3 sm:px-6 text-xs text-warning-fg">
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
          The document type could not be confirmed from its text. If the type is wrong, reject the
          extraction.
        </p>
      ) : null}
      {documentIssues.map((issue) => (
        <p
          key={issue.code}
          className="flex gap-2 border-b border-line-subtle bg-warning-subtle px-4 py-3 sm:px-6 text-xs text-warning-fg"
        >
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
          {ISSUE_LABEL[issue.code]}
        </p>
      ))}
      {showJson ? (
        // The extraction exactly as the API returns it, corrections included.
        <pre
          tabIndex={0}
          aria-label="Extracted data as JSON"
          className="max-h-[60vh] overflow-auto bg-surface-subtle px-4 py-3 font-mono text-xs leading-relaxed text-fg sm:px-6"
        >
          {JSON.stringify(extraction, null, 2)}
        </pre>
      ) : (
        <ul
          className="divide-y divide-line-subtle"
          aria-label="Extracted fields"
          onKeyDown={editable ? handleFieldKeys : undefined}
        >
          {extraction.fields.map((field) => (
            <FieldRow
              key={field.name}
              field={field}
              currency={typeof currency === 'string' ? currency : null}
              editable={editable}
              onReview={reviewField}
            />
          ))}
        </ul>
      )}
      {editable ? (
        <DecisionBar
          flagged={extraction.fields.filter((field) => field.needsReview).length}
          remaining={remaining.length}
          onApprove={() => decide('approve', {})}
          onReject={(reason) => decide('reject', reason.trim() ? { reason } : {})}
        />
      ) : null}
    </div>
  );
}
