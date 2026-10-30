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
        <h1 className="text-2xl font-bold tracking-tight wrap-anywhere text-gray-900">{title}</h1>
        {description ? <p className="mt-1 text-sm text-gray-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
    </div>
  );
}
