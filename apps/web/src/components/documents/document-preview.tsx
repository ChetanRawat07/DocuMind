import type { DocumentDto } from '@documind/shared';
import { FileQuestion } from 'lucide-react';
import { cx } from '../../lib/cx';
import { useDelayedLoading } from '../../lib/delayed-loading';
import { useDocumentPreview } from '../../services/use-document-preview';
import { EmptyState, ErrorState, Skeleton } from '../ui/feedback';
import { DownloadDocumentButton } from './download-document-button';

/**
 * The document itself: images as an image, PDFs in the browser's built-in
 * viewer. <object> rather than <iframe> because it has fallback content:
 * browsers without an inline PDF viewer (common on mobile) show the
 * download button instead of an empty frame.
 */
export function DocumentPreview({ document }: { document: DocumentDto }) {
  const preview = useDocumentPreview(document);
  const load = useDelayedLoading(preview.status === 'loading');
  const label = `Preview of ${document.originalFilename}`;

  if (load.skeleton) return <PreviewSkeleton className={load.skeletonClass} />;
  switch (preview.status) {
    case 'unsupported':
      return (
        <EmptyState
          icon={FileQuestion}
          title="No preview for this file type"
          description="Download the file to open it."
          className={load.revealClass}
        />
      );
    case 'loading':
      return <PreviewSkeleton />;
    case 'error':
      return (
        <ErrorState
          title="Could not load the preview"
          description="Check your connection and try again."
          onRetry={preview.retry}
          className={load.revealClass}
        />
      );
    case 'ready':
      return document.mimeType === 'application/pdf' ? (
        <object
          // Fit the page width: the default "whole page" zoom leaves wide side bars.
          data={`${preview.url}#view=FitH`}
          type="application/pdf"
          aria-label={label}
          className={cx('block h-[75vh] min-h-96 w-full lg:h-[calc(100vh-9rem)]', load.revealClass)}
        >
          <div className="flex flex-col items-center gap-4 px-6 py-10 text-center text-sm text-fg-secondary">
            <p>This browser cannot show PDFs here.</p>
            <DownloadDocumentButton document={document} variant="secondary" />
          </div>
        </object>
      ) : (
        <div className={cx('grid place-items-center bg-surface-subtle p-4', load.revealClass)}>
          <img
            src={preview.url}
            alt={label}
            className="max-h-[75vh] max-w-full rounded-md border border-line object-contain"
          />
        </div>
      );
  }
}

/** Loading placeholder the size of the PDF viewer, the usual preview. */
export function PreviewSkeleton({ className }: { className?: string | undefined }) {
  return (
    <div className={className}>
      <p role="status" className="sr-only">
        Loading preview…
      </p>
      <Skeleton className="h-[75vh] min-h-96 rounded-none lg:h-[calc(100vh-9rem)]" />
    </div>
  );
}
