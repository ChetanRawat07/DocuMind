import { type Analytics, analyticsSchema, documentListResponseSchema } from '@documind/shared';
import { ArrowRight, FileText } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { useCurrentUser } from '../auth/current-user';
import { DocumentTypes, ProcessingVolume } from '../components/analytics/analytics-cards';
import { DocumentTable } from '../components/documents/document-table';
import { buttonClasses, FOCUS_RING } from '../components/ui/button-styles';
import { Card, CardHeader } from '../components/ui/card';
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from '../components/ui/feedback';
import { PageHeader } from '../components/ui/page-header';
import { StatCard, StatGroup } from '../components/ui/stat-card';
import { NAV_ITEMS } from '../layout/navigation';
import { analyticsPath, correctionRateKpi } from '../lib/analytics-view';
import { cx } from '../lib/cx';
import { formatPercent } from '../lib/format';
import { type DelayedLoading, useDelayedLoading } from '../lib/delayed-loading';
import { greetingFor } from '../lib/greeting';
import { DASHBOARD_RANGE } from '../services/page-queries';
import { type QueryState, useApiQuery } from '../services/use-api-query';

export const RECENT_DOCUMENTS_LIMIT = 5;

function KeyMetrics({
  analytics,
  load,
}: {
  analytics: QueryState<Analytics>;
  load: DelayedLoading;
}) {
  // Held with the charts' skeleton, so the metrics and charts appear together.
  if (analytics.status !== 'success' || load.skeleton) {
    // Loading or failed: dashes rather than invented numbers; the charts below show the error.
    // Processed keeps its sparkline's room, so the row does not grow when the data loads.
    return (
      <>
        {['Documents', 'Processed', 'Correction rate', 'Needs review'].map((label) => (
          <StatCard
            key={label}
            label={label}
            value={null}
            hint={analytics.status === 'error' ? 'Unavailable' : 'Loading…'}
            {...(label === 'Processed' ? { trend: [] } : {})}
          />
        ))}
      </>
    );
  }
  const { documents, successRate, volume } = analytics.data;
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
        trend={volume.map((day) => day.processed)}
        hint={
          successRate === null ? 'None finished yet' : `${formatPercent(successRate)} succeeded`
        }
      />
      <StatCard label="Correction rate" value={corrections.value} hint={corrections.hint} />
      <StatCard
        to={NAV_ITEMS.review.path}
        label="Needs review"
        value={documents.needsReview.toLocaleString()}
        hint="Waiting now"
      />
    </>
  );
}

function ChartCard({
  analytics,
  load,
  children,
}: {
  analytics: QueryState<Analytics> & { retry: () => void };
  load: DelayedLoading;
  children: (data: Analytics) => ReactNode;
}) {
  if (load.skeleton || analytics.status === 'loading') {
    // The chart's height plus its date labels.
    return (
      <div aria-hidden="true" className={cx('mt-4', load.skeletonClass)}>
        <Skeleton className="h-48" />
        <div className="mt-2 h-4" />
      </div>
    );
  }
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
  return <div className={cx('mt-4', load.revealClass)}>{children(analytics.data)}</div>;
}

function RecentDocuments({ now }: { now: Date }) {
  const recent = useApiQuery(
    `/documents?limit=${RECENT_DOCUMENTS_LIMIT}`,
    documentListResponseSchema,
  );
  const load = useDelayedLoading(recent.status === 'loading');

  if (load.skeleton || recent.status === 'loading') {
    return (
      <SkeletonRows
        label="Loading recent documents…"
        rows={RECENT_DOCUMENTS_LIMIT}
        stacked
        className={load.skeletonClass}
      />
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
            viewTransition
            className={buttonClasses('primary', 'sm')}
          >
            Upload a document
          </Link>
        }
      />
    );
  }
  return (
    <div className={load.revealClass}>
      <DocumentTable documents={recent.data.items} caption="Recent documents" now={now} pulse />
    </div>
  );
}

export function DashboardPage() {
  const user = useCurrentUser();
  // Read the clock once per visit; render stays pure.
  const [now] = useState(() => new Date());
  const greeting = greetingFor(now);
  const analytics = useApiQuery(analyticsPath(DASHBOARD_RANGE), analyticsSchema);
  const analyticsLoad = useDelayedLoading(analytics.status === 'loading');

  return (
    <>
      <PageHeader
        title={user.displayName ? `${greeting}, ${user.displayName}` : greeting}
        documentTitle={NAV_ITEMS.dashboard.label}
        description={new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(now)}
      />

      <StatGroup aria-labelledby="metrics-heading" className="grid-cols-2 xl:grid-cols-4">
        <h2 id="metrics-heading" className="sr-only">
          Key metrics
        </h2>
        <KeyMetrics analytics={analytics} load={analyticsLoad} />
      </StatGroup>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-4 sm:p-6 lg:col-span-2">
          <CardHeader
            title="Processing activity"
            description={`Documents processed over the last ${String(DASHBOARD_RANGE)} days`}
          />
          <ChartCard analytics={analytics} load={analyticsLoad}>
            {(data) => <ProcessingVolume analytics={data} />}
          </ChartCard>
        </Card>
        <Card className="p-4 sm:p-6">
          <CardHeader
            title="Document types"
            description={`Documents processed over the last ${String(DASHBOARD_RANGE)} days`}
          />
          <ChartCard analytics={analytics} load={analyticsLoad}>
            {(data) => <DocumentTypes analytics={data} />}
          </ChartCard>
        </Card>
      </div>

      <Card className="mt-6 overflow-clip">
        <CardHeader
          title="Recent documents"
          description="Latest uploads in your workspace"
          className="border-b border-line px-4 py-3 sm:px-6"
          action={
            <Link
              to={NAV_ITEMS.documents.path}
              viewTransition
              className={cx(
                'inline-flex items-center gap-1 rounded-md text-compact font-medium text-accent-fg hover:underline',
                FOCUS_RING,
              )}
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
