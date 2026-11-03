import type { Analytics } from '@documind/shared';
import { Activity, ClipboardCheck, Gauge, PieChart } from 'lucide-react';
import { CONFIDENCE_BUCKET_LABEL, documentTypeLabel } from '../../lib/analytics-view';
import { formatCalendarDate, formatPercent } from '../../lib/format';
import { BarChart, MeterList } from '../ui/charts';
import { EmptyState } from '../ui/feedback';

const period = (analytics: Analytics) => `the last ${String(analytics.days)} days`;

/** Documents processed per day, oldest first, with the window's first and last day under it. */
export function ProcessingVolume({ analytics }: { analytics: Analytics }) {
  if (analytics.documents.processed === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No processing activity yet"
        description={`No document finished processing in ${period(analytics)}.`}
      />
    );
  }
  const first = analytics.volume[0];
  const last = analytics.volume.at(-1);
  return (
    <>
      <BarChart
        caption={`Documents processed per day, ${period(analytics)}`}
        data={analytics.volume.map((day) => ({
          label: formatCalendarDate(day.date),
          value: day.processed,
        }))}
      />
      {first && last ? (
        <div aria-hidden="true" className="mt-2 flex justify-between text-xs text-gray-500">
          <span>{formatCalendarDate(first.date)}</span>
          <span>{formatCalendarDate(last.date)}</span>
        </div>
      ) : null}
    </>
  );
}

export function DocumentTypes({ analytics }: { analytics: Analytics }) {
  if (analytics.documentTypes.length === 0) {
    return (
      <EmptyState
        icon={PieChart}
        title="No classified documents yet"
        description="The mix of invoices, contracts and purchase orders will appear here."
      />
    );
  }
  return (
    <MeterList
      data={analytics.documentTypes.map((entry) => ({
        label: documentTypeLabel(entry.type),
        value: entry.count,
      }))}
    />
  );
}

/** How confident the latest extraction of each document was; a review signal, not accuracy. */
export function ConfidenceDistribution({ analytics }: { analytics: Analytics }) {
  if (analytics.review.extracted === 0) {
    return (
      <EmptyState
        icon={Gauge}
        title="No extractions yet"
        description="Confidence scores of extracted documents will appear here."
      />
    );
  }
  return (
    <MeterList
      data={analytics.confidence.map((entry) => ({
        label: CONFIDENCE_BUCKET_LABEL[entry.bucket],
        value: entry.count,
      }))}
    />
  );
}

/** Where extractions went: completed on their own, approved or rejected by a person, or waiting. */
export function ReviewOutcomes({ analytics }: { analytics: Analytics }) {
  const { review } = analytics;
  if (review.extracted === 0) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="Nothing reviewed yet"
        description="Review outcomes of extracted documents will appear here."
      />
    );
  }
  return (
    <>
      <p className="mb-4 text-sm text-gray-600">
        {review.rate === null ? null : (
          <>
            <span className="font-semibold text-gray-900">{formatPercent(review.rate)}</span> of
            extractions needed a person.
          </>
        )}
      </p>
      <MeterList
        data={[
          { label: 'Completed automatically', value: review.autoCompleted },
          { label: 'Approved after review', value: review.approvedAfterReview },
          { label: 'Rejected', value: review.rejected },
          { label: 'Waiting for review', value: review.pending },
        ]}
      />
    </>
  );
}
