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
import { useId, useState } from 'react';
import { DOCUMENT_TYPE_LABEL } from '../../lib/document-labels';
import { ISSUE_LABEL } from '../../lib/extraction-labels';
import { formatDateTime, formatPercent } from '../../lib/format';
import { ApiError, SessionExpiredError } from '../../services/api-client';
import { useApi } from '../../services/use-api';
import { useApiQuery } from '../../services/use-api-query';
import { Button } from '../ui/button';
import { EmptyState, ErrorState, Spinner } from '../ui/feedback';
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
      <p className="flex gap-2 px-5 py-3 text-sm text-green-800">
        <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {decidedBy === 'system'
          ? `Approved automatically on ${when}: every value was found in the document and passed its checks.`
          : `Approved on ${when}.`}
      </p>
    );
  }
  return (
    <div className="px-5 py-3 text-sm text-red-800">
      <p className="flex gap-2">
        <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        Rejected on {when}. Reprocess the document to extract it again.
      </p>
      {rejectReason ? <p className="mt-1 text-gray-700">Reason: {rejectReason}</p> : null}
    </div>
  );
}

/**
 * Approve once every flagged field is checked, or reject with an optional
 * reason. The API enforces the same rule; the button only mirrors it.
 */
function DecisionBar({
  remaining,
  onApprove,
  onReject,
}: {
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
      <div className="space-y-2 border-t border-gray-100 px-5 py-4">
        <label htmlFor={reasonId} className="block text-sm font-medium text-gray-700">
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
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-xs focus:border-brand-600 focus:ring-3 focus:ring-brand-600/20 focus:outline-none"
        />
        <div className="flex gap-2">
          <Button
            size="sm"
            className="bg-red-600 hover:bg-red-700"
            disabled={busy}
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
          <p role="alert" className="text-xs text-red-700">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t border-gray-100 px-5 py-4">
      <p id={hintId} className="text-xs text-gray-600">
        {remaining > 0
          ? `Confirm or correct ${String(remaining)} more flagged ${remaining === 1 ? 'field' : 'fields'} to approve.`
          : 'Every flagged field is checked. Approving makes these values final.'}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy || remaining > 0}
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
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
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

  if (result.status === 'loading')
    return <Spinner label="Loading extracted data…" className="py-10" />;
  if (result.status === 'error') {
    return (
      <ErrorState
        title="Could not load the extracted data"
        description="Check your connection and try again."
        onRetry={result.retry}
      />
    );
  }

  const extraction = saved?.id === result.data.id ? saved : result.data;
  const editable = document.status === 'needs_review' && extraction.review.decision === null;
  const currency = extraction.fields.find((field) => field.name === 'currency')?.value;
  const remaining = extraction.fields.filter((field) => field.needsReview && !field.reviewed);
  const documentIssues = extraction.issues.filter((issue) => issue.fields.length === 0);
  const reload = () => {
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
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3">
        <p className="text-sm text-gray-600">
          {DOCUMENT_TYPE_LABEL[extraction.documentType]}
          {extraction.classificationConfidence < REVIEW_CONFIDENCE_THRESHOLD ? (
            <span className="text-amber-800"> (type uncertain)</span>
          ) : null}
        </p>
        <p
          className="text-sm font-semibold text-gray-900 tabular-nums"
          title="The lowest score of any value: a review signal, not a probability."
        >
          Confidence {formatPercent(extraction.overallConfidence)}
        </p>
      </div>
      <DecisionNote extraction={extraction} />
      {editable && extraction.classificationConfidence < REVIEW_CONFIDENCE_THRESHOLD ? (
        <p className="flex gap-2 border-b border-gray-100 bg-amber-50/70 px-5 py-3 text-xs text-amber-900">
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
          The document type could not be confirmed from its text. If the type is wrong, reject the
          extraction.
        </p>
      ) : null}
      {documentIssues.map((issue) => (
        <p
          key={issue.code}
          className="flex gap-2 border-b border-gray-100 bg-amber-50/70 px-5 py-3 text-xs text-amber-900"
        >
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
          {ISSUE_LABEL[issue.code]}
        </p>
      ))}
      <ul className="divide-y divide-gray-100" aria-label="Extracted fields">
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
      {editable ? (
        <DecisionBar
          remaining={remaining.length}
          onApprove={() => decide('approve', {})}
          onReject={(reason) => decide('reject', reason.trim() ? { reason } : {})}
        />
      ) : null}
    </div>
  );
}
