import {
  type OwnedProcessingJobDto,
  type OwnedProcessingJobListResponse,
  ownedProcessingJobListResponseSchema,
  PROCESSING_JOB_STATUSES,
  type ProcessingJobStatus,
  type ProcessingSummary,
  processingSummarySchema,
} from '@documind/shared';
import { Workflow } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { FOCUS_RING, SEGMENTED_GROUP, segmentClasses } from '../components/ui/button-styles';
import { Card, CardHeader } from '../components/ui/card';
import { EmptyState, ErrorState, SkeletonRows } from '../components/ui/feedback';
import { PageHeader } from '../components/ui/page-header';
import { StatCard, StatGroup, StatGroupSkeleton } from '../components/ui/stat-card';
import { StatusBadge } from '../components/ui/status-badge';
import { ROW, TABLE, TABLE_WRAP, TD, TH } from '../components/ui/table-styles';
import { NAV_ITEMS } from '../layout/navigation';
import { JOB_STATUS_DISPLAY, jobErrorLabel } from '../lib/activity-labels';
import { cx } from '../lib/cx';
import { useDelayedLoading } from '../lib/delayed-loading';
import { documentDetailPath } from '../lib/document-view';
import { formatDuration, formatRelativeTime } from '../lib/format';
import { PROCESSING_SUMMARY_PATH } from '../services/page-queries';
import { type QueryState, useApiQuery } from '../services/use-api-query';

/** Shown in the table; the API's default page. */
export const PROCESSING_JOBS_LIMIT = 50;

const duration = (ms: number | null) => (ms === null ? null : formatDuration(ms));

function Summary({ summary }: { summary: ProcessingSummary }) {
  const period = `Last ${String(summary.windowDays)} days`;
  return (
    <>
      <StatGroup aria-label="Processing summary" className="grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="In queue"
          value={String(summary.queued + summary.running)}
          hint={`${String(summary.queued)} queued · ${String(summary.running)} running`}
        />
        <StatCard
          label="Completed"
          value={String(summary.succeeded)}
          hint={`${String(summary.failed)} failed · ${period.toLowerCase()}`}
        />
        <StatCard
          label="Processing time"
          value={duration(summary.processingMs.average)}
          hint={
            summary.processingMs.p95 === null
              ? `Average · ${period.toLowerCase()}`
              : `Average · 95% within ${formatDuration(summary.processingMs.p95)}`
          }
        />
        <StatCard
          label="Step time"
          value={duration(summary.aiMs.average)}
          hint={`AI average · text and OCR ${duration(summary.textExtractionMs.average) ?? '—'}`}
        />
      </StatGroup>
      {summary.failuresByCode.length > 0 ? (
        <Card className="mt-4 overflow-clip">
          <CardHeader
            title="Why jobs failed"
            description={period}
            className="border-b border-line px-4 py-3 sm:px-6"
          />
          <ul className="divide-y divide-line-subtle">
            {summary.failuresByCode.map((failure) => (
              <li
                key={failure.code}
                className="flex justify-between gap-4 px-4 py-2 sm:px-6 text-compact"
              >
                <span className="text-fg">{jobErrorLabel(failure.code)}</span>
                <span className="font-medium text-fg tabular-nums">{failure.count}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

function JobRow({ job, now }: { job: OwnedProcessingJobDto; now: Date }) {
  const display = JOB_STATUS_DISPLAY[job.status];
  const total =
    job.startedAt && job.finishedAt
      ? new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()
      : null;
  return (
    <tr className={ROW}>
      <td className={cx(TD, 'max-w-64')}>
        <Link
          to={documentDetailPath(job.document.id)}
          viewTransition
          className={cx(
            'block truncate rounded-md font-medium text-fg hover:text-accent-fg hover:underline',
            FOCUS_RING,
          )}
        >
          {job.document.originalFilename}
        </Link>
        <p className="text-xs text-fg-muted">
          <time dateTime={job.createdAt}>{formatRelativeTime(job.createdAt, now)}</time>
          {job.requestId ? (
            <>
              {' · '}
              <span className="font-mono" title={`Request ${job.requestId}`}>
                {job.requestId.slice(0, 8)}
              </span>
            </>
          ) : null}
        </p>
      </td>
      <td className={TD}>
        <StatusBadge tone={display.tone} label={display.label} />
        {job.status === 'running' && job.stage ? (
          <p className="mt-1 text-xs text-fg-muted">
            {job.stage === 'text_extraction' ? 'Reading text' : 'AI extraction'}
          </p>
        ) : null}
        {job.errorCode ? (
          <p className="mt-1 text-xs text-danger-fg">{jobErrorLabel(job.errorCode)}</p>
        ) : null}
      </td>
      <td className={cx(TD, 'hidden text-right font-mono text-xs text-fg-secondary sm:table-cell')}>
        {job.attempts}/{job.maxAttempts}
      </td>
      <td className={cx(TD, 'hidden text-right font-mono text-xs text-fg-secondary md:table-cell')}>
        {duration(job.textExtractionMs) ?? '—'}
      </td>
      <td className={cx(TD, 'hidden text-right font-mono text-xs text-fg-secondary md:table-cell')}>
        {duration(job.aiMs) ?? '—'}
      </td>
      <td className={cx(TD, 'text-right font-mono text-xs font-medium text-fg')}>
        {duration(total) ?? '—'}
      </td>
    </tr>
  );
}

function Jobs({ status }: { status: ProcessingJobStatus | undefined }) {
  const [now] = useState(() => new Date());
  const path = `/processing/jobs?limit=${String(PROCESSING_JOBS_LIMIT)}${status ? `&status=${status}` : ''}`;
  const jobs = useApiQuery(path, ownedProcessingJobListResponseSchema);
  const load = useDelayedLoading(jobs.status === 'loading');

  if (load.skeleton || jobs.status === 'loading') {
    return <SkeletonRows label="Loading jobs…" rows={8} className={load.skeletonClass} />;
  }
  return <div className={load.revealClass}>{jobsBody(jobs, status, now)}</div>;
}

function jobsBody(
  jobs: Exclude<QueryState<OwnedProcessingJobListResponse>, { status: 'loading' }> & {
    retry: () => void;
  },
  status: ProcessingJobStatus | undefined,
  now: Date,
) {
  if (jobs.status === 'error') {
    return (
      <ErrorState
        title="Could not load jobs"
        description="Check your connection and try again."
        onRetry={jobs.retry}
        error={jobs.error}
      />
    );
  }
  if (jobs.data.items.length === 0) {
    return (
      <EmptyState
        icon={Workflow}
        title={status ? `No ${JOB_STATUS_DISPLAY[status].label.toLowerCase()} jobs` : 'No jobs yet'}
        description="Each upload or reprocess request creates a processing job."
      />
    );
  }
  return (
    <div className={TABLE_WRAP}>
      <table className={TABLE}>
        <caption className="sr-only">
          Processing jobs, newest first. Times are for text extraction, AI and the whole job.
        </caption>
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Document
            </th>
            <th scope="col" className={TH}>
              Status
            </th>
            <th scope="col" className={cx(TH, 'hidden text-right sm:table-cell')}>
              Attempts
            </th>
            <th scope="col" className={cx(TH, 'hidden text-right md:table-cell')}>
              Text
            </th>
            <th scope="col" className={cx(TH, 'hidden text-right md:table-cell')}>
              AI
            </th>
            <th scope="col" className={cx(TH, 'text-right')}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {jobs.data.items.map((job) => (
            <JobRow key={job.id} job={job} now={now} />
          ))}
        </tbody>
      </table>
      {jobs.data.items.length === PROCESSING_JOBS_LIMIT ? (
        <p className="border-t border-line px-4 py-3 sm:px-6 text-xs text-fg-muted">
          Showing the {PROCESSING_JOBS_LIMIT} most recent jobs.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The processing pipeline for the user's documents: what is waiting or
 * running, how recent jobs went, how long each step takes and why jobs fail.
 */
export function ProcessingPage() {
  const summary = useApiQuery(PROCESSING_SUMMARY_PATH, processingSummarySchema);
  const summaryLoad = useDelayedLoading(summary.status === 'loading');
  const [status, setStatus] = useState<ProcessingJobStatus | undefined>(undefined);

  return (
    <>
      <PageHeader
        title={NAV_ITEMS.processing.label}
        description={NAV_ITEMS.processing.description}
      />
      {summaryLoad.skeleton || summary.status === 'loading' ? (
        <StatGroupSkeleton
          label="Loading the summary…"
          count={4}
          className={cx('grid-cols-2 lg:grid-cols-4', summaryLoad.skeletonClass)}
        />
      ) : summary.status === 'error' ? (
        <Card>
          <ErrorState
            title="Could not load the summary"
            description="Check your connection and try again."
            onRetry={summary.retry}
            error={summary.error}
          />
        </Card>
      ) : (
        <div className={summaryLoad.revealClass}>
          <Summary summary={summary.data} />
        </div>
      )}
      <Card className="mt-4 overflow-clip">
        <CardHeader
          title="Jobs"
          description="Newest first"
          className="border-b border-line px-4 py-3 sm:px-6"
          action={
            <div role="group" aria-label="Filter by status" className={SEGMENTED_GROUP}>
              {[undefined, ...PROCESSING_JOB_STATUSES].map((option) => (
                <button
                  key={option ?? 'all'}
                  type="button"
                  aria-pressed={status === option}
                  onClick={() => {
                    setStatus(option);
                  }}
                  className={segmentClasses(status === option)}
                >
                  {option ? JOB_STATUS_DISPLAY[option].label : 'All'}
                </button>
              ))}
            </div>
          }
        />
        <Jobs status={status} />
      </Card>
    </>
  );
}
