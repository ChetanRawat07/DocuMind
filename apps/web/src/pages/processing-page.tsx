import {
  type OwnedProcessingJobDto,
  ownedProcessingJobListResponseSchema,
  PROCESSING_JOB_STATUSES,
  type ProcessingJobStatus,
  type ProcessingSummary,
  processingSummarySchema,
} from '@documind/shared';
import { Workflow } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Card, CardHeader } from '../components/ui/card';
import { EmptyState, ErrorState, Spinner } from '../components/ui/feedback';
import { PageHeader } from '../components/ui/page-header';
import { StatCard } from '../components/ui/stat-card';
import { StatusBadge } from '../components/ui/status-badge';
import { NAV_ITEMS } from '../layout/navigation';
import { JOB_STATUS_DISPLAY, jobErrorLabel } from '../lib/activity-labels';
import { cx } from '../lib/cx';
import { documentDetailPath } from '../lib/document-view';
import { formatDuration, formatRelativeTime } from '../lib/format';
import { useApiQuery } from '../services/use-api-query';

/** Shown in the table; the API's default page. */
export const PROCESSING_JOBS_LIMIT = 50;

const duration = (ms: number | null) => (ms === null ? null : formatDuration(ms));

function Summary({ summary }: { summary: ProcessingSummary }) {
  const period = `Last ${String(summary.windowDays)} days`;
  return (
    <>
      <section aria-label="Processing summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
      </section>
      {summary.failuresByCode.length > 0 ? (
        <Card className="mt-4 overflow-hidden">
          <CardHeader
            title="Why jobs failed"
            description={period}
            className="border-b border-gray-100 px-5 py-4"
          />
          <ul className="divide-y divide-gray-100">
            {summary.failuresByCode.map((failure) => (
              <li key={failure.code} className="flex justify-between gap-4 px-5 py-3 text-sm">
                <span className="text-gray-900">{jobErrorLabel(failure.code)}</span>
                <span className="font-semibold text-gray-900 tabular-nums">{failure.count}</span>
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
    <tr className="border-b border-gray-100 last:border-0">
      <td className="max-w-64 px-5 py-3">
        <Link
          to={documentDetailPath(job.document.id)}
          className="block truncate font-medium text-gray-900 hover:text-brand-700 hover:underline"
        >
          {job.document.originalFilename}
        </Link>
        <p className="text-xs text-gray-500">
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
      <td className="px-5 py-3">
        <StatusBadge tone={display.tone} label={display.label} />
        {job.status === 'running' && job.stage ? (
          <p className="mt-1 text-xs text-gray-500">
            {job.stage === 'text_extraction' ? 'Reading text' : 'AI extraction'}
          </p>
        ) : null}
        {job.errorCode ? (
          <p className="mt-1 text-xs text-red-800">{jobErrorLabel(job.errorCode)}</p>
        ) : null}
      </td>
      <td className="hidden px-5 py-3 text-right tabular-nums sm:table-cell">
        {job.attempts}/{job.maxAttempts}
      </td>
      <td className="hidden px-5 py-3 text-right tabular-nums md:table-cell">
        {duration(job.textExtractionMs) ?? '—'}
      </td>
      <td className="hidden px-5 py-3 text-right tabular-nums md:table-cell">
        {duration(job.aiMs) ?? '—'}
      </td>
      <td className="px-5 py-3 text-right tabular-nums">{duration(total) ?? '—'}</td>
    </tr>
  );
}

function Jobs({ status }: { status: ProcessingJobStatus | undefined }) {
  const [now] = useState(() => new Date());
  const path = `/processing/jobs?limit=${String(PROCESSING_JOBS_LIMIT)}${status ? `&status=${status}` : ''}`;
  const jobs = useApiQuery(path, ownedProcessingJobListResponseSchema);

  if (jobs.status === 'loading') return <Spinner label="Loading jobs…" className="py-10" />;
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
  const th = 'px-5 py-3 font-medium whitespace-nowrap';
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">
          Processing jobs, newest first. Times are for text extraction, AI and the whole job.
        </caption>
        <thead className="text-xs tracking-wide text-gray-500 uppercase">
          <tr className="border-b border-gray-100">
            <th scope="col" className={th}>
              Document
            </th>
            <th scope="col" className={th}>
              Status
            </th>
            <th scope="col" className={cx(th, 'hidden text-right sm:table-cell')}>
              Attempts
            </th>
            <th scope="col" className={cx(th, 'hidden text-right md:table-cell')}>
              Text
            </th>
            <th scope="col" className={cx(th, 'hidden text-right md:table-cell')}>
              AI
            </th>
            <th scope="col" className={cx(th, 'text-right')}>
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
        <p className="border-t border-gray-100 px-5 py-3 text-xs text-gray-500">
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
  const summary = useApiQuery('/processing/summary', processingSummarySchema);
  const [status, setStatus] = useState<ProcessingJobStatus | undefined>(undefined);

  return (
    <>
      <PageHeader
        title={NAV_ITEMS.processing.label}
        description={NAV_ITEMS.processing.description}
      />
      {summary.status === 'loading' ? (
        <Spinner label="Loading the summary…" className="py-6" />
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
        <Summary summary={summary.data} />
      )}
      <Card className="mt-4 overflow-hidden">
        <CardHeader
          title="Jobs"
          description="Newest first"
          className="border-b border-gray-100 px-5 py-4"
          action={
            <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
              {[undefined, ...PROCESSING_JOB_STATUSES].map((option) => (
                <button
                  key={option ?? 'all'}
                  type="button"
                  aria-pressed={status === option}
                  onClick={() => {
                    setStatus(option);
                  }}
                  className={cx(
                    'rounded-md px-2.5 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
                    status === option
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-gray-600 hover:bg-gray-100',
                  )}
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
