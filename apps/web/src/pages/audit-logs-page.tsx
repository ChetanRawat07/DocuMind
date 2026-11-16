import { type AuditLogEntryDto, auditLogListResponseSchema } from '@documind/shared';
import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { FOCUS_RING } from '../components/ui/button-styles';
import { Card, CardHeader } from '../components/ui/card';
import { EmptyState, ErrorState, SkeletonRows } from '../components/ui/feedback';
import { PageHeader } from '../components/ui/page-header';
import { ROW, TABLE, TABLE_WRAP, TD, TH } from '../components/ui/table-styles';
import { NAV_ITEMS } from '../layout/navigation';
import { cx } from '../lib/cx';
import { useDelayedLoading } from '../lib/delayed-loading';
import { auditActionLabel, describeAuditEntry } from '../lib/activity-labels';
import { documentDetailPath } from '../lib/document-view';
import { formatDateTime } from '../lib/format';
import { SessionExpiredError } from '../services/api-client';
import { AUDIT_LOG_FIRST_PAGE_PATH } from '../services/page-queries';
import { useApi } from '../services/use-api';
import { useApiQuery } from '../services/use-api-query';

function EntryRow({ entry }: { entry: AuditLogEntryDto }) {
  const detail = describeAuditEntry(entry);
  return (
    <tr className={cx(ROW, 'align-top')}>
      <td className={cx(TD, 'font-mono text-xs whitespace-nowrap text-fg-secondary')}>
        <time dateTime={entry.occurredAt}>{formatDateTime(entry.occurredAt)}</time>
      </td>
      <td className={TD}>
        <p className="font-medium text-fg">{auditActionLabel(entry.action)}</p>
        {detail ? <p className="text-xs text-fg-muted">{detail}</p> : null}
      </td>
      <td className={cx(TD, 'hidden text-fg-secondary sm:table-cell')}>
        {entry.actor === 'user' ? 'You' : 'System'}
      </td>
      <td className={cx(TD, 'hidden md:table-cell')}>
        {entry.resourceType === 'document' && entry.resourceId ? (
          <Link
            to={documentDetailPath(entry.resourceId)}
            viewTransition
            className={cx('rounded-md text-accent-fg hover:underline', FOCUS_RING)}
            aria-label={`Open the document of this ${auditActionLabel(entry.action).toLowerCase()} entry`}
          >
            Document
          </Link>
        ) : (
          <span className="text-fg-secondary">{entry.resourceType}</span>
        )}
      </td>
      <td className={cx(TD, 'hidden lg:table-cell')}>
        {entry.requestId ? (
          <span className="font-mono text-xs text-fg-secondary select-all" title={entry.requestId}>
            {entry.requestId.slice(0, 8)}
          </span>
        ) : (
          <span className="text-fg-muted">—</span>
        )}
      </td>
    </tr>
  );
}

/**
 * The user's audit trail, newest first: their own actions and the system's
 * actions on their documents. Request ids match entries to server logs.
 */
export function AuditLogsPage() {
  const api = useApi();
  const first = useApiQuery(AUDIT_LOG_FIRST_PAGE_PATH, auditLogListResponseSchema);
  const [more, setMore] = useState<{
    items: AuditLogEntryDto[];
    nextCursor: string | null;
    status: 'idle' | 'loading' | 'error';
  } | null>(null);

  const load = useDelayedLoading(first.status === 'loading');

  let body;
  if (load.skeleton || first.status === 'loading') {
    body = <SkeletonRows label="Loading the audit log…" rows={8} className={load.skeletonClass} />;
  } else if (first.status === 'error') {
    body = (
      <ErrorState
        title="Could not load the audit log"
        description="Check your connection and try again."
        onRetry={first.retry}
        error={first.error}
      />
    );
  } else if (first.data.items.length === 0) {
    body = (
      <EmptyState
        icon={ScrollText}
        title="No activity yet"
        description="Uploads, processing and reviews will be recorded here."
      />
    );
  } else {
    const items = [...first.data.items, ...(more?.items ?? [])];
    const nextCursor = more ? more.nextCursor : first.data.nextCursor;
    const loadMore = async () => {
      if (!nextCursor) return;
      setMore((previous) => ({
        items: previous?.items ?? [],
        nextCursor,
        status: 'loading',
      }));
      try {
        const page = await api.get(
          `${AUDIT_LOG_FIRST_PAGE_PATH}&cursor=${encodeURIComponent(nextCursor)}`,
          auditLogListResponseSchema,
        );
        setMore((previous) => ({
          items: [...(previous?.items ?? []), ...page.items],
          nextCursor: page.nextCursor,
          status: 'idle',
        }));
      } catch (error) {
        if (error instanceof SessionExpiredError) return;
        setMore((previous) => ({ items: previous?.items ?? [], nextCursor, status: 'error' }));
      }
    };
    body = (
      <>
        <div className={TABLE_WRAP}>
          <table className={TABLE}>
            <caption className="sr-only">Audit log, newest first</caption>
            <thead>
              <tr>
                <th scope="col" className={TH}>
                  Time
                </th>
                <th scope="col" className={TH}>
                  Action
                </th>
                <th scope="col" className={cx(TH, 'hidden sm:table-cell')}>
                  Actor
                </th>
                <th scope="col" className={cx(TH, 'hidden md:table-cell')}>
                  Resource
                </th>
                <th scope="col" className={cx(TH, 'hidden lg:table-cell')}>
                  Request
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <EntryRow key={entry.id} entry={entry} />
              ))}
            </tbody>
          </table>
        </div>
        {nextCursor ? (
          <div className="flex flex-col items-center gap-2 border-t border-line px-4 py-3 sm:px-6">
            {more?.status === 'error' ? (
              <p role="alert" className="text-xs text-danger-fg">
                Could not load more entries.
              </p>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              loading={more?.status === 'loading'}
              onClick={() => void loadMore()}
            >
              {more?.status === 'loading' ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <PageHeader title={NAV_ITEMS.auditLogs.label} description={NAV_ITEMS.auditLogs.description} />
      <Card className="overflow-clip">
        <CardHeader
          title="Activity"
          description="Your actions, and processing of your documents"
          className="border-b border-line px-4 py-3 sm:px-6"
        />
        {load.skeleton ? body : <div className={load.revealClass}>{body}</div>}
      </Card>
    </>
  );
}
