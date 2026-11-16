import type { ReactNode } from 'react';

/**
 * Page heading (the page's only h1) and browser tab title. React 19 hoists
 * the <title> element into the document head.
 */
export function PageHeader({
  title,
  description,
  documentTitle = title,
  actions,
}: {
  title: string;
  description?: string;
  documentTitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <title>{`${documentTitle} · DocuMind`}</title>
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold tracking-[-0.025em] wrap-anywhere text-fg sm:text-[1.75rem] sm:leading-9">
          {title}
        </h1>
        {description ? <p className="mt-1 text-sm text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
