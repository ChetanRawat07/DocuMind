import { type DocumentDto, documentActivityResponseSchema } from '@documind/shared';
import { useState } from 'react';
import { auditActionLabel, describeAuditEntry } from '../../lib/activity-labels';
import { cx } from '../../lib/cx';
import { useDelayedLoading } from '../../lib/delayed-loading';
import { formatDateTime, formatRelativeTime } from '../../lib/format';
import { useApiQuery } from '../../services/use-api-query';
import { ErrorState, Skeleton } from '../ui/feedback';

export function ActivitySkeleton({ className }: { className?: string | undefined }) {
  return (
    <div className={cx('divide-y divide-line-subtle', className)}>
      <p role="status" className="sr-only">
        Loading activity…
      </p>
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="space-y-2 px-4 py-3 sm:px-6">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-2.5 w-24" />
        </div>
      ))}
    </div>
  );
}

/**
 * The document's history, newest first: upload, processing steps with their
 * timings, review and file access. The page keys it by status, so it
 * reloads after a review decision or reprocessing.
 */
export function DocumentActivity({ document }: { document: DocumentDto }) {
  const [now] = useState(() => new Date());
  const path = `/documents/${encodeURIComponent(document.id)}/activity`;
  const activity = useApiQuery(path, documentActivityResponseSchema);
  const load = useDelayedLoading(activity.status === 'loading');

  if (load.skeleton || activity.status === 'loading') {
    return <ActivitySkeleton className={load.skeletonClass} />;
  }
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
    <ol className={cx('px-4 py-3 sm:px-6', load.revealClass)} aria-label="Document activity">
      {activity.data.items.map((entry) => {
        const detail = describeAuditEntry(entry);
        return (
          // A dot per entry on a line joining them; the last entry ends the line.
          <li
            key={entry.id}
            className="relative pb-4 pl-6 before:absolute before:top-2 before:bottom-0 before:left-[3px] before:w-px before:bg-line last:pb-0 last:before:hidden"
          >
            <span
              aria-hidden="true"
              className="absolute top-1.5 left-0 size-[7px] rounded-full border border-line-strong bg-surface"
            />
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-compact font-medium text-fg">
                {auditActionLabel(entry.action)}
                <span className="font-normal text-fg-muted">
                  {entry.actor === 'system' ? ' · System' : ''}
                </span>
              </p>
              <time
                dateTime={entry.occurredAt}
                title={formatDateTime(entry.occurredAt)}
                className="shrink-0 text-xs text-fg-muted"
              >
                {formatRelativeTime(entry.occurredAt, now)}
              </time>
            </div>
            {detail ? <p className="text-xs text-fg-muted">{detail}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
