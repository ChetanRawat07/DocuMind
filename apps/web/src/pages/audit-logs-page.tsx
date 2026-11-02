import {
  type AuditLogEntryDto,
  auditLogListResponseSchema,
  DEFAULT_AUDIT_LOG_PAGE_SIZE,
} from '@documind/shared';
import { ScrollText } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { Card, CardHeader } from '../components/ui/card';
import { EmptyState, ErrorState, Spinner } from '../components/ui/feedback';
import { PageHeader } from '../components/ui/page-header';
import { NAV_ITEMS } from '../layout/navigation';
import { auditActionLabel, describeAuditEntry } from '../lib/activity-labels';
import { documentDetailPath } from '../lib/document-view';
import { formatDateTime } from '../lib/format';
import { SessionExpiredError } from '../services/api-client';
import { useApi } from '../services/use-api';
import { useApiQuery } from '../services/use-api-query';

const firstPagePath = `/audit-logs?limit=${String(DEFAULT_AUDIT_LOG_PAGE_SIZE)}`;

function EntryRow({ entry }: { entry: AuditLogEntryDto }) {
  const detail = describeAuditEntry(entry);
  return (
    <tr className="border-b border-gray-100 align-top last:border-0">
      <td className="px-5 py-3 whitespace-nowrap text-gray-600">
        <time dateTime={entry.occurredAt}>{formatDateTime(entry.occurredAt)}</time>
      </td>
      <td className="px-5 py-3">
        <p className="font-medium text-gray-900">{auditActionLabel(entry.action)}</p>
        {detail ? <p className="text-xs text-gray-500">{detail}</p> : null}
      </td>
      <td className="hidden px-5 py-3 text-gray-600 sm:table-cell">
        {entry.actor === 'user' ? 'You' : 'System'}
      </td>
      <td className="hidden px-5 py-3 md:table-cell">
        {entry.resourceType === 'document' && entry.resourceId ? (
          <Link
            to={documentDetailPath(entry.resourceId)}
            className="text-brand-700 hover:underline"
            aria-label={`Open the document of this ${auditActionLabel(entry.action).toLowerCase()} entry`}
          >
            Document
          </Link>
        ) : (
          <span className="text-gray-600">{entry.resourceType}</span>
        )}
      </td>
      <td className="hidden px-5 py-3 lg:table-cell">
        {entry.requestId ? (
          <span className="font-mono text-xs text-gray-600 select-all" title={entry.requestId}>
            {entry.requestId.slice(0, 8)}
          </span>
        ) : (
          <span className="text-gray-400">—</span>
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
  const first = useApiQuery(firstPagePath, auditLogListResponseSchema);
  const [more, setMore] = useState<{
    items: AuditLogEntryDto[];
    nextCursor: string | null;
    status: 'idle' | 'loading' | 'error';
  } | null>(null);

  let body;
  if (first.status === 'loading') {
    body = <Spinner label="Loading the audit log…" className="py-10" />;
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
          `${firstPagePath}&cursor=${encodeURIComponent(nextCursor)}`,
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
    const th = 'px-5 py-3 font-medium whitespace-nowrap';
    body = (
      <>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Audit log, newest first</caption>
            <thead className="text-xs tracking-wide text-gray-500 uppercase">
              <tr className="border-b border-gray-100">
                <th scope="col" className={th}>
                  Time
                </th>
                <th scope="col" className={th}>
                  Action
                </th>
                <th scope="col" className={`${th} hidden sm:table-cell`}>
                  Actor
                </th>
                <th scope="col" className={`${th} hidden md:table-cell`}>
                  Resource
                </th>
                <th scope="col" className={`${th} hidden lg:table-cell`}>
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
          <div className="flex flex-col items-center gap-2 border-t border-gray-100 px-5 py-4">
            {more?.status === 'error' ? (
              <p role="alert" className="text-xs text-red-700">
                Could not load more entries.
              </p>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              disabled={more?.status === 'loading'}
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
      <Card className="overflow-hidden">
        <CardHeader
          title="Activity"
          description="Your actions, and processing of your documents"
          className="border-b border-gray-100 px-5 py-4"
        />
        {body}
      </Card>
    </>
  );
}
