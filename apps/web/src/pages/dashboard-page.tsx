import { type Analytics, analyticsSchema, documentListResponseSchema } from '@documind/shared';
import { ArrowRight, FileText } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { useCurrentUser } from '../auth/current-user';
import { DocumentTypes, ProcessingVolume } from '../components/analytics/analytics-cards';
import { DocumentTable } from '../components/documents/document-table';
import { buttonClasses } from '../components/ui/button-styles';
import { Card, CardHeader } from '../components/ui/card';
import { EmptyState, ErrorState, Skeleton } from '../components/ui/feedback';
import { PageHeader } from '../components/ui/page-header';
import { StatCard } from '../components/ui/stat-card';
import { NAV_ITEMS } from '../layout/navigation';
import { analyticsPath, correctionRateKpi } from '../lib/analytics-view';
import { formatPercent } from '../lib/format';
import { greetingFor } from '../lib/greeting';
import { type QueryState, useApiQuery } from '../services/use-api-query';

export const RECENT_DOCUMENTS_LIMIT = 5;

/** The dashboard's window; the Analytics page offers the others. */
export const DASHBOARD_RANGE = 30;

function KeyMetrics({ analytics }: { analytics: QueryState<Analytics> }) {
  if (analytics.status !== 'success') {
    // Loading or failed: dashes rather than invented numbers; the charts below show the error.
    return (
      <>
        {['Documents', 'Processed', 'Correction rate', 'Needs review'].map((label) => (
          <StatCard
            key={label}
            label={label}
            value={null}
            hint={analytics.status === 'loading' ? 'Loading…' : 'Unavailable'}
          />
        ))}
      </>
    );
  }
  const { documents, successRate } = analytics.data;
  const corrections = correctionRateKpi(analytics.data);
  return (
    <>
      <StatCard
        label="Documents"
        value={documents.uploaded.toLocaleString()}
        hint={`Uploaded in the last ${String(DASHBOARD_RANGE)} days`}
      />
      <StatCard
        label="Processed"
        value={documents.processed.toLocaleString()}
        hint={
          successRate === null ? 'None finished yet' : `${formatPercent(successRate)} succeeded`
        }
      />
      <StatCard label="Correction rate" value={corrections.value} hint={corrections.hint} />
      <StatCard
        label="Needs review"
        value={documents.needsReview.toLocaleString()}
        hint="Waiting now"
      />
    </>
  );
}

function ChartCard({
  analytics,
  children,
}: {
  analytics: QueryState<Analytics> & { retry: () => void };
  children: (data: Analytics) => ReactNode;
}) {
  if (analytics.status === 'loading') return <Skeleton className="mt-4 h-52" />;
  if (analytics.status === 'error') {
    return (
      <ErrorState
        title="Could not load analytics"
        description="Check your connection and try again."
        onRetry={analytics.retry}
        error={analytics.error}
      />
    );
  }
  return <div className="mt-4">{children(analytics.data)}</div>;
}

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
        error={recent.error}
      />
    );
  }
  if (recent.data.items.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No documents yet"
        description="Documents you upload will appear here with their processing status."
        action={
          <Link
            to={`${NAV_ITEMS.documents.path}#upload`}
            className={buttonClasses('secondary', 'sm')}
          >
            Upload a document
          </Link>
        }
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
  const analytics = useApiQuery(analyticsPath(DASHBOARD_RANGE), analyticsSchema);

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
          <KeyMetrics analytics={analytics} />
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-3">
          <CardHeader
            title="Processing activity"
            description={`Documents processed over the last ${String(DASHBOARD_RANGE)} days`}
          />
          <ChartCard analytics={analytics}>
            {(data) => <ProcessingVolume analytics={data} />}
          </ChartCard>
        </Card>
        <Card className="p-5 lg:col-span-2">
          <CardHeader
            title="Document types"
            description={`Documents processed over the last ${String(DASHBOARD_RANGE)} days`}
          />
          <ChartCard analytics={analytics}>
            {(data) => <DocumentTypes analytics={data} />}
          </ChartCard>
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
