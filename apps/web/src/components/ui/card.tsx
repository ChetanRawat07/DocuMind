import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx('rounded-xl border border-gray-200 bg-white shadow-xs', className)}
      {...props}
    />
  );
}

/** Card title row. The title is an h2: pages own the h1. */
export function CardHeader({
  title,
  description,
  action,
  titleId,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  titleId?: string;
  className?: string;
}) {
  return (
    <div className={cx('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h2 id={titleId} className="text-sm font-semibold text-gray-900">
          {title}
        </h2>
        {description ? <p className="mt-1 text-xs text-gray-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
