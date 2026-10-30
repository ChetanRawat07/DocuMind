import { documentListResponseSchema } from '@documind/shared';
import { Activity, ArrowRight, FileText, PieChart } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useCurrentUser } from '../auth/current-user';
import { DocumentTable } from '../components/documents/document-table';
import { Card, CardHeader } from '../components/ui/card';
import { EmptyState, ErrorState, Skeleton } from '../components/ui/feedback';
import { PageHeader } from '../components/ui/page-header';
import { StatCard } from '../components/ui/stat-card';
import { NAV_ITEMS } from '../layout/navigation';
import { greetingFor } from '../lib/greeting';
import { useApiQuery } from '../services/use-api-query';

export const RECENT_DOCUMENTS_LIMIT = 5;

/**
 * Metrics have no API until analytics is built, so each card shows an
 * explicit "no data yet" state rather than invented numbers.
 */
const METRICS = [
  { label: 'Documents' },
  { label: 'Processed' },
  { label: 'Extraction accuracy' },
  { label: 'Needs review' },
] as const;

function RecentDocuments({ now }: { now: Date }) {
  const recent = useApiQuery(
    `/documents?limit=${RECENT_DOCUMENTS_LIMIT}`,
    documentListResponseSchema,
  );

  if (recent.status === 'loading') {
    return (
      <div className="space-y-4 px-5 py-4">
        <p role="status" className="sr-only">
          Loading recent documents…
        </p>
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton className="size-9" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-48 max-w-full" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (recent.status === 'error') {
    return (
      <ErrorState
        title="Could not load documents"
        description="Check your connection and try again."
        onRetry={recent.retry}
      />
    );
  }
  if (recent.data.items.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No documents yet"
        description="Documents you upload will appear here with their processing status."
      />
    );
  }
  return <DocumentTable documents={recent.data.items} caption="Recent documents" now={now} />;
}

export function DashboardPage() {
  const user = useCurrentUser();
  // Read the clock once per visit; render stays pure.
  const [now] = useState(() => new Date());
  const greeting = greetingFor(now);

  return (
    <>
      <PageHeader
        title={user.displayName ? `${greeting}, ${user.displayName}` : greeting}
        documentTitle={NAV_ITEMS.dashboard.label}
        description={NAV_ITEMS.dashboard.description}
      />

      <section aria-labelledby="metrics-heading">
        <h2 id="metrics-heading" className="sr-only">
          Key metrics
        </h2>
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {METRICS.map((metric) => (
            <StatCard key={metric.label} label={metric.label} value={null} hint="No data yet" />
          ))}
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-3">
          <CardHeader
            title="Processing activity"
            description="Documents processed over the last 30 days"
          />
          <EmptyState
            icon={Activity}
            title="No processing activity yet"
            description="Daily processing volume will appear here once documents are processed."
          />
        </Card>
        <Card className="p-5 lg:col-span-2">
          <CardHeader title="Document types" description="Documents processed this month" />
          <EmptyState
            icon={PieChart}
            title="No classified documents yet"
            description="The mix of invoices, contracts and purchase orders will appear here."
          />
        </Card>
      </div>

      <Card className="mt-4 overflow-hidden">
        <CardHeader
          title="Recent documents"
          description="Latest uploads in your workspace"
          className="border-b border-gray-100 px-5 py-4"
          action={
            <Link
              to={NAV_ITEMS.documents.path}
              className="inline-flex items-center gap-1 rounded-md text-xs font-semibold text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              View all
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          }
        />
        <RecentDocuments now={now} />
      </Card>
    </>
  );
}
