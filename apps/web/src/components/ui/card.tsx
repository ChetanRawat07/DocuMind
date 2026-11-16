import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/cx';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('rounded-xl border border-line bg-surface', className)} {...props} />;
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
    <div className={cx('flex flex-wrap items-center justify-between gap-x-4 gap-y-2', className)}>
      <div className="min-w-0">
        <h2 id={titleId} className="text-sm font-semibold text-fg">
          {title}
        </h2>
        {description ? <p className="mt-1 text-xs text-fg-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
