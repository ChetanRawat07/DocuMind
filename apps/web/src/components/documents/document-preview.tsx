import type { DocumentDto } from '@documind/shared';
import { FileQuestion } from 'lucide-react';
import { useDocumentPreview } from '../../services/use-document-preview';
import { EmptyState, ErrorState, Spinner } from '../ui/feedback';
import { DownloadDocumentButton } from './download-document-button';

/**
 * The document itself: images as an image, PDFs in the browser's built-in
 * viewer. <object> rather than <iframe> because it has fallback content:
 * browsers without an inline PDF viewer (common on mobile) show the
 * download button instead of an empty frame.
 */
export function DocumentPreview({ document }: { document: DocumentDto }) {
  const preview = useDocumentPreview(document);
  const label = `Preview of ${document.originalFilename}`;

  switch (preview.status) {
    case 'unsupported':
      return (
        <EmptyState
          icon={FileQuestion}
          title="No preview for this file type"
          description="Download the file to open it."
        />
      );
    case 'loading':
      return <Spinner label="Loading preview…" className="px-5 py-10" />;
    case 'error':
      return (
        <ErrorState
          title="Could not load the preview"
          description="Check your connection and try again."
          onRetry={preview.retry}
        />
      );
    case 'ready':
      return document.mimeType === 'application/pdf' ? (
        <object
          data={preview.url}
          type="application/pdf"
          aria-label={label}
          className="block h-[75vh] min-h-96 w-full"
        >
          <div className="flex flex-col items-center gap-4 px-6 py-10 text-center text-sm text-gray-600">
            <p>This browser cannot show PDFs here.</p>
            <DownloadDocumentButton document={document} variant="secondary" />
          </div>
        </object>
      ) : (
        <div className="grid place-items-center bg-gray-50 p-4">
          <img
            src={preview.url}
            alt={label}
            className="max-h-[75vh] max-w-full rounded-md object-contain shadow-xs"
          />
        </div>
      );
  }
}
