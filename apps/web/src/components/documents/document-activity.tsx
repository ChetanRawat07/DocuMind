import { type DocumentDto, documentActivityResponseSchema } from '@documind/shared';
import { useState } from 'react';
import { auditActionLabel, describeAuditEntry } from '../../lib/activity-labels';
import { formatDateTime, formatRelativeTime } from '../../lib/format';
import { useApiQuery } from '../../services/use-api-query';
import { ErrorState, Spinner } from '../ui/feedback';

/**
 * The document's history, newest first: upload, processing steps with their
 * timings, review and file access. The page keys it by status, so it
 * reloads after a review decision or reprocessing.
 */
export function DocumentActivity({ document }: { document: DocumentDto }) {
  const [now] = useState(() => new Date());
  const path = `/documents/${encodeURIComponent(document.id)}/activity`;
  const activity = useApiQuery(path, documentActivityResponseSchema);

  if (activity.status === 'loading') return <Spinner label="Loading activity…" className="py-6" />;
  if (activity.status === 'error') {
    return (
      <ErrorState
        title="Could not load the activity"
        description="Check your connection and try again."
        onRetry={activity.retry}
        error={activity.error}
      />
    );
  }
  return (
    <ol className="divide-y divide-gray-100" aria-label="Document activity">
      {activity.data.items.map((entry) => {
        const detail = describeAuditEntry(entry);
        return (
          <li key={entry.id} className="px-5 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium text-gray-900">
                {auditActionLabel(entry.action)}
                <span className="font-normal text-gray-500">
                  {entry.actor === 'system' ? ' · System' : ''}
                </span>
              </p>
              <time
                dateTime={entry.occurredAt}
                title={formatDateTime(entry.occurredAt)}
                className="shrink-0 text-xs text-gray-500"
              >
                {formatRelativeTime(entry.occurredAt, now)}
              </time>
            </div>
            {detail ? <p className="text-xs text-gray-500">{detail}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
