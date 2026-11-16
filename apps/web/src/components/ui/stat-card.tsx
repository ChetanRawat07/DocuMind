import type { HTMLAttributes } from 'react';
import { Link } from 'react-router';
import { cx } from '../../lib/cx';
import { FOCUS_RING } from './button-styles';
import { Skeleton } from './feedback';

/**
 * One KPI. `value` is preformatted text; null means there is no data yet,
 * shown as a dash rather than a misleading zero. Place it in a StatGroup.
 * `trend` draws a sparkline of the values behind it and `to` links the cell.
 */
export function StatCard({
  label,
  value,
  hint,
  trend,
  to,
}: {
  label: string;
  value: string | null;
  hint?: string;
  trend?: readonly number[];
  to?: string;
}) {
  const body = (
    <>
      <dl>
        <dt className="text-compact text-fg-muted">{label}</dt>
        <dd className="mt-1 font-display text-2xl font-bold tracking-[-0.025em] text-fg tabular-nums">
          {value === null ? (
            <>
              <span aria-hidden="true" className="text-fg-muted">
                —
              </span>
              <span className="sr-only">No data yet</span>
            </>
          ) : (
            value
          )}
        </dd>
      </dl>
      {hint ? <p className="mt-1 text-xs text-fg-muted">{hint}</p> : null}
      {trend && trend.length > 1 ? (
        <Sparkline values={trend} className="mt-3" />
      ) : trend ? (
        // No values yet: keep the sparkline's room so the card does not grow when they load.
        <div className="mt-3 h-8" />
      ) : null}
    </>
  );
  const cell = 'min-w-0 bg-surface px-4 py-4 sm:px-6 sm:py-5';
  return to ? (
    <Link
      to={to}
      viewTransition
      className={cx(
        cell,
        'block transition-colors duration-150 hover:bg-surface-subtle',
        FOCUS_RING,
        'focus-visible:-outline-offset-2',
      )}
    >
      {body}
    </Link>
  ) : (
    <div className={cell}>{body}</div>
  );
}

/** A 32px line of `values`, oldest first, scaled to their range. Decorative. */
export function Sparkline({
  values,
  className,
}: {
  values: readonly number[];
  className?: string;
}) {
  const max = Math.max(1, ...values);
  const points = values
    .map(
      (value, index) =>
        `${String((index / (values.length - 1)) * 100)},${String(30 - (value / max) * 28)}`,
    )
    .join(' ');
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      className={cx('block h-8 w-full text-accent', className)}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** One bordered panel of StatCards separated by 1px lines; pass the grid columns in className. */
export function StatGroup({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cx(
        'grid gap-px overflow-hidden rounded-xl border border-line bg-line-subtle',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Loading placeholder shaped like a StatGroup of `count` metrics: each bar
 * sits in a box the height of the StatCard line it stands for.
 */
export function StatGroupSkeleton({
  label,
  count,
  className,
}: {
  label: string;
  count: number;
  className?: string | undefined;
}) {
  return (
    <StatGroup className={className}>
      <p role="status" className="sr-only">
        {label}
      </p>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="bg-surface px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex h-5 items-center">
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="mt-1 flex h-8 items-center">
            <Skeleton className="h-6 w-16" />
          </div>
          <div className="mt-1 flex h-4 items-center">
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
      ))}
    </StatGroup>
  );
}
