import { CircleAlert, LoaderCircle, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { ApiError } from '../../services/api-client';
import { Button } from './button';

/** Announced to screen readers; the spinner itself is decorative. */
export function Spinner({ label, className }: { label: string; className?: string }) {
  return (
    <p role="status" className={cx('flex items-center gap-2 text-sm text-fg-muted', className)}>
      <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
      {label}
    </p>
  );
}

/** Placeholder block shown while content loads. Pair it with a Spinner or status text. */
export function Skeleton({ className }: { className?: string | undefined }) {
  return (
    <span
      aria-hidden="true"
      className={cx('block rounded-md bg-surface-muted motion-safe:animate-pulse', className)}
    />
  );
}

/**
 * Table-shaped loading placeholder with the loading message for screen
 * readers: a header row and `rows` rows as tall as a table row of a name
 * over a timestamp (see table-styles), so the table that replaces it takes
 * the same space. `stacked` leaves room for the status badge DocumentTable
 * puts under the name on phones; `header={false}` is for lists.
 */
export function SkeletonRows({
  label,
  rows = 5,
  header = true,
  stacked = false,
  className,
}: {
  label: string;
  rows?: number;
  header?: boolean;
  stacked?: boolean;
  className?: string | undefined;
}) {
  return (
    <div className={className}>
      <p role="status" className="sr-only">
        {label}
      </p>
      {header ? (
        <div className="h-9 bg-surface-subtle shadow-[inset_0_-1px_0_var(--color-line)]" />
      ) : null}
      <div className="divide-y divide-line-subtle">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-3 px-4 py-1.5 sm:px-6">
            <Skeleton className="size-6 shrink-0" />
            <div className="flex-1">
              <div className="flex h-5 items-center">
                <Skeleton className="h-3 w-56 max-w-full" />
              </div>
              <div className="flex h-4 items-center">
                <Skeleton className="h-2.5 w-24" />
              </div>
              {stacked ? <div className="mt-1 h-5 sm:hidden" /> : null}
            </div>
            <Skeleton className="hidden h-5 w-20 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cx('flex flex-col items-center px-6 py-12 text-center', className)}>
      <Icon aria-hidden="true" strokeWidth={1.25} className="size-10 text-fg-muted" />
      <p className="mt-4 text-sm font-semibold text-fg">{title}</p>
      <p className="mt-1 max-w-sm text-compact text-fg-muted">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/**
 * A failed load with a way to try again. Messages are fixed text, never raw
 * server errors. When the failure is an API error, its request id is shown as
 * a reference the user can quote, which support can find in the logs.
 */
export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
  error,
  className,
}: {
  title?: string;
  description: string;
  onRetry?: () => void;
  error?: unknown;
  className?: string | undefined;
}) {
  const reference = error instanceof ApiError ? error.requestId : null;
  return (
    <div
      role="alert"
      className={cx('flex flex-col items-center px-6 py-12 text-center', className)}
    >
      <CircleAlert aria-hidden="true" strokeWidth={1.25} className="size-10 text-danger-fg" />
      <p className="mt-4 text-sm font-semibold text-fg">{title}</p>
      <p className="mt-1 max-w-sm text-compact text-fg-muted">{description}</p>
      {reference ? (
        <p className="mt-2 text-xs text-fg-muted">
          Reference: <span className="font-mono select-all">{reference}</span>
        </p>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
