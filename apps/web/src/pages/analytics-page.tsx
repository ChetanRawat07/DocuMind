import {
  ANALYTICS_RANGES,
  type AnalyticsRange,
  analyticsSchema,
  DEFAULT_ANALYTICS_RANGE,
} from '@documind/shared';
import { useSearchParams } from 'react-router';
import {
  ConfidenceDistribution,
  DocumentTypes,
  ProcessingVolume,
  ReviewOutcomes,
} from '../components/analytics/analytics-cards';
import { SEGMENTED_GROUP, segmentClasses } from '../components/ui/button-styles';
import { Card, CardHeader } from '../components/ui/card';
import { ErrorState, Skeleton } from '../components/ui/feedback';
import { PageHeader } from '../components/ui/page-header';
import { StatCard, StatGroup, StatGroupSkeleton } from '../components/ui/stat-card';
import { NAV_ITEMS } from '../layout/navigation';
import { analyticsPath, correctionRateKpi } from '../lib/analytics-view';
import { useDelayedLoading } from '../lib/delayed-loading';
import { formatDuration, formatPercent } from '../lib/format';
import { useApiQuery } from '../services/use-api-query';

/** The range from the URL (`?days=`), so a view can be reloaded and shared; the default otherwise. */
function rangeFrom(params: URLSearchParams): AnalyticsRange {
  const days = Number(params.get('days'));
  return (ANALYTICS_RANGES as readonly number[]).includes(days)
    ? (days as AnalyticsRange)
    : DEFAULT_ANALYTICS_RANGE;
}

const percentOrNull = (rate: number | null) => (rate === null ? null : formatPercent(rate));

/**
 * Processing and review over the last 7, 30 or 90 days, counted by when each
 * document's processing reached its outcome, in the viewer's timezone.
 */
export function AnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const days = rangeFrom(params);
  const analytics = useApiQuery(analyticsPath(days), analyticsSchema);
  const load = useDelayedLoading(analytics.status === 'loading');

  let body;
  if (load.skeleton || analytics.status === 'loading') {
    // The metrics and the volume chart with its header and date labels, at their loaded size.
    body = (
      <div className={load.skeletonClass}>
        <StatGroupSkeleton
          label="Loading analytics…"
          count={5}
          className="grid-cols-2 xl:grid-cols-5 [&>:last-child]:col-span-2 xl:[&>:last-child]:col-span-1"
        />
        <Card aria-hidden="true" className="mt-4 p-4 sm:p-6">
          <CardHeader title="Processing volume" description="Documents processed per day" />
          <Skeleton className="mt-4 h-48" />
          <div className="mt-2 h-4" />
        </Card>
      </div>
    );
  } else if (analytics.status === 'error') {
    body = (
      <Card>
        <ErrorState
          title="Could not load analytics"
          description="Check your connection and try again."
          onRetry={analytics.retry}
          error={analytics.error}
        />
      </Card>
    );
  } else {
    const data = analytics.data;
    const corrections = correctionRateKpi(data);
    body = (
      <>
        <StatGroup
          aria-label="Key metrics"
          // Five metrics: the last one spans the row until all five fit on one line.
          className="grid-cols-2 xl:grid-cols-5 [&>:last-child]:col-span-2 xl:[&>:last-child]:col-span-1"
        >
          <StatCard
            label="Processed"
            value={data.documents.processed.toLocaleString()}
            hint={`${data.documents.uploaded.toLocaleString()} uploaded`}
          />
          <StatCard
            label="Success rate"
            value={percentOrNull(data.successRate)}
            hint={`${data.documents.succeeded.toLocaleString()} extracted`}
          />
          <StatCard
            label="Failure rate"
            value={percentOrNull(data.failureRate)}
            hint={`${data.documents.failed.toLocaleString()} failed`}
          />
          <StatCard
            label="Processing time"
            value={
              data.processingMs.average === null ? null : formatDuration(data.processingMs.average)
            }
            hint={
              data.processingMs.p95 === null
                ? 'Average'
                : `Average · 95% within ${formatDuration(data.processingMs.p95)}`
            }
          />
          <StatCard label="Correction rate" value={corrections.value} hint={corrections.hint} />
        </StatGroup>

        <Card className="mt-4 p-4 sm:p-6">
          <CardHeader title="Processing volume" description="Documents processed per day" />
          <div className="mt-4">
            <ProcessingVolume analytics={data} />
          </div>
        </Card>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Card className="p-4 sm:p-6">
            <CardHeader title="Document types" description="Documents processed" />
            <div className="mt-4">
              <DocumentTypes analytics={data} />
            </div>
          </Card>
          <Card className="p-4 sm:p-6">
            <CardHeader
              title="Extraction confidence"
              description="Lowest score of each extraction: a review signal, not accuracy"
            />
            <div className="mt-4">
              <ConfidenceDistribution analytics={data} />
            </div>
          </Card>
          <Card className="p-4 sm:p-6">
            <CardHeader title="Review" description="What happened to each extraction" />
            <div className="mt-4">
              <ReviewOutcomes analytics={data} />
            </div>
          </Card>
        </div>
        <p className="mt-4 text-xs text-fg-muted">
          Counted by when processing finished, in {data.timezone}. The correction rate covers values
          a person checked; automatically completed documents are not reviewed.
        </p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={NAV_ITEMS.analytics.label}
        description={NAV_ITEMS.analytics.description}
        actions={
          <div role="group" aria-label="Time range" className={SEGMENTED_GROUP}>
            {ANALYTICS_RANGES.map((range) => (
              <button
                key={range}
                type="button"
                aria-pressed={days === range}
                onClick={() => {
                  setParams(range === DEFAULT_ANALYTICS_RANGE ? {} : { days: String(range) }, {
                    preventScrollReset: true,
                  });
                }}
                className={segmentClasses(days === range)}
              >
                {range} days
              </button>
            ))}
          </div>
        }
      />
      {load.skeleton ? body : <div className={load.revealClass}>{body}</div>}
    </>
  );
}
