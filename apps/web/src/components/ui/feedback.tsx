import { CircleAlert, LoaderCircle, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { Button } from './button';

/** Announced to screen readers; the spinner itself is decorative. */
export function Spinner({ label, className }: { label: string; className?: string }) {
  return (
    <p role="status" className={cx('flex items-center gap-2 text-sm text-gray-500', className)}>
      <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
      {label}
    </p>
  );
}

/** Placeholder block shown while content loads. Pair it with a Spinner or status text. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx('block rounded-md bg-gray-100 motion-safe:animate-pulse', className)}
    />
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
  className?: string;
}) {
  return (
    <div className={cx('flex flex-col items-center px-6 py-10 text-center', className)}>
      <span className="grid size-10 place-items-center rounded-full bg-brand-50 text-brand-600">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <p className="mt-3 text-sm font-semibold text-gray-900">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-gray-500">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** A failed load with a way to try again. Messages are fixed text, never raw server errors. */
export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
  className,
}: {
  title?: string;
  description: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cx('flex flex-col items-center px-6 py-10 text-center', className)}
    >
      <span className="grid size-10 place-items-center rounded-full bg-red-50 text-red-600">
        <CircleAlert aria-hidden="true" className="size-5" />
      </span>
      <p className="mt-3 text-sm font-semibold text-gray-900">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-gray-500">{description}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
