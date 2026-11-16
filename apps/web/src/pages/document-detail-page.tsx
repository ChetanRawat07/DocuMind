import { type DocumentDto, documentSchema } from '@documind/shared';
import { ArrowLeft, FileX } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ActivitySkeleton, DocumentActivity } from '../components/documents/document-activity';
import { DeleteDocumentButton } from '../components/documents/delete-document-button';
import { DocumentPreview, PreviewSkeleton } from '../components/documents/document-preview';
import { DownloadDocumentButton } from '../components/documents/download-document-button';
import { ReprocessButton } from '../components/documents/reprocess-button';
import { ExtractionPanel, ExtractionSkeleton } from '../components/review/extraction-panel';
import { buttonClasses } from '../components/ui/button-styles';
import { Card, CardHeader } from '../components/ui/card';
import { EmptyState, ErrorState, Skeleton } from '../components/ui/feedback';
import { PageHeader } from '../components/ui/page-header';
import { DocumentStatusBadge } from '../components/ui/status-badge';
import { NAV_ITEMS } from '../layout/navigation';
import { cx } from '../lib/cx';
import { useDelayedLoading } from '../lib/delayed-loading';
import { DOCUMENT_TYPE_LABEL, fileTypeLabel } from '../lib/document-labels';
import { formatBytes, formatDateTime } from '../lib/format';
import { ApiError } from '../services/api-client';
import { useApiQuery } from '../services/use-api-query';

const CARD_HEADER_CLASS = 'border-b border-line px-4 py-3 sm:px-6';
/** Rows in DocumentDetails, for its loading placeholder. */
const DETAIL_ROWS = 7;

const BACK_LINK_CLASS =
  'mb-3 inline-flex items-center gap-1 rounded-md text-compact text-fg-muted transition-colors duration-150 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

function BackToDocuments() {
  return (
    <Link to={NAV_ITEMS.documents.path} viewTransition className={BACK_LINK_CLASS}>
      <ArrowLeft aria-hidden="true" className="size-3.5" />
      All documents
    </Link>
  );
}

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2 sm:px-6">
      <dt className="text-compact text-fg-muted">{term}</dt>
      <dd className="text-right text-compact text-fg">{children}</dd>
    </div>
  );
}

function DocumentDetails({ document }: { document: DocumentDto }) {
  return (
    <dl className="divide-y divide-line-subtle">
      <Detail term="Status">
        <DocumentStatusBadge status={document.status} />
      </Detail>
      <Detail term="Document type">
        {document.documentType ? DOCUMENT_TYPE_LABEL[document.documentType] : 'Not classified'}
      </Detail>
      <Detail term="File type">{fileTypeLabel(document.mimeType)}</Detail>
      <Detail term="Size">
        <span className="tabular-nums">{formatBytes(document.sizeBytes)}</span>
      </Detail>
      <Detail term="Uploaded">
        <time dateTime={document.createdAt}>{formatDateTime(document.createdAt)}</time>
      </Detail>
      <Detail term="Last updated">
        <time dateTime={document.updatedAt}>{formatDateTime(document.updatedAt)}</time>
      </Detail>
      <Detail term="Processed">
        {document.processedAt ? (
          <time dateTime={document.processedAt}>{formatDateTime(document.processedAt)}</time>
        ) : (
          'Not yet'
        )}
      </Detail>
    </dl>
  );
}

/**
 * One document: its metadata, a preview of the file beside its extracted
 * fields for review, download, reprocess and delete. Another user's document
 * and a missing one look the same here, as in the API.
 */
export function DocumentDetailPage() {
  const { documentId = '' } = useParams();
  const navigate = useNavigate();
  const result = useApiQuery(`/documents/${encodeURIComponent(documentId)}`, documentSchema);
  const load = useDelayedLoading(result.status === 'loading');
  // The document as a review decision or reprocessing left it, until the next load.
  const [changed, setChanged] = useState<DocumentDto | null>(null);

  if (load.skeleton || result.status === 'loading') {
    // The loaded page's frame: same header lines, cards and card headers, with placeholders inside.
    return (
      <>
        <BackToDocuments />
        {/* A blank description and button row keep the header's loaded height. */}
        <PageHeader
          title="Document"
          description={'\u00a0'}
          actions={<Skeleton className={cx('h-9 w-52', load.skeletonClass)} />}
        />
        <p role="status" className="sr-only">
          Loading document…
        </p>
        <div
          aria-hidden="true"
          className={cx('grid items-start gap-4 lg:grid-cols-5', load.skeletonClass)}
        >
          <Card className="overflow-clip lg:sticky lg:top-18 lg:col-span-3">
            <CardHeader title="Preview" className={CARD_HEADER_CLASS} />
            <PreviewSkeleton />
          </Card>
          <div className="space-y-4 lg:col-span-2">
            <Card className="overflow-clip">
              <CardHeader title="Extracted data" className={CARD_HEADER_CLASS} />
              <ExtractionSkeleton />
            </Card>
            <Card className="overflow-clip">
              <CardHeader title="Details" className={CARD_HEADER_CLASS} />
              <div className="divide-y divide-line-subtle">
                {Array.from({ length: DETAIL_ROWS }, (_, index) => (
                  <div key={index} className="flex h-9 items-center justify-between px-4 sm:px-6">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                ))}
              </div>
            </Card>
            <Card className="overflow-clip">
              <CardHeader title="Activity" className={CARD_HEADER_CLASS} />
              <ActivitySkeleton />
            </Card>
          </div>
        </div>
      </>
    );
  }
  if (result.status === 'error') {
    // 400 is a malformed id in the URL, which is just as missing as an unknown one.
    const notFound =
      result.error instanceof ApiError &&
      (result.error.status === 404 || result.error.status === 400);
    return (
      <>
        <BackToDocuments />
        <PageHeader title={notFound ? 'Document not found' : 'Document unavailable'} />
        <Card>
          {notFound ? (
            <EmptyState
              icon={FileX}
              title="This document does not exist"
              description="It may have been deleted, or the link may be wrong."
              action={
                <Link
                  to={NAV_ITEMS.documents.path}
                  viewTransition
                  className={buttonClasses('primary', 'sm')}
                >
                  Go to documents
                </Link>
              }
            />
          ) : (
            <ErrorState
              title="Could not load the document"
              description="Check your connection and try again."
              onRetry={result.retry}
              error={result.error}
            />
          )}
        </Card>
      </>
    );
  }

  const document = changed?.id === result.data.id ? changed : result.data;
  return (
    <>
      <BackToDocuments />
      <PageHeader
        title={document.originalFilename}
        description={`${fileTypeLabel(document.mimeType)} · ${formatBytes(document.sizeBytes)}`}
        actions={
          <>
            <ReprocessButton document={document} onQueued={setChanged} />
            <DownloadDocumentButton document={document} />
            <DeleteDocumentButton
              document={document}
              showLabel
              onDeleted={() => {
                // Replace, so Back does not return to the deleted document.
                void navigate(NAV_ITEMS.documents.path, { replace: true });
              }}
            />
          </>
        }
      />
      <div className={cx('grid items-start gap-4 lg:grid-cols-5', load.revealClass)}>
        <Card className="overflow-clip lg:col-span-3">
          <CardHeader title="Preview" className={CARD_HEADER_CLASS} />
          <DocumentPreview document={document} />
        </Card>
        <div className="space-y-4 lg:col-span-2">
          <Card className="overflow-clip">
            <CardHeader title="Extracted data" className={CARD_HEADER_CLASS} />
            <ExtractionPanel document={document} onDocumentChange={setChanged} />
          </Card>
          <Card className="overflow-clip">
            <CardHeader title="Details" className={CARD_HEADER_CLASS} />
            <DocumentDetails document={document} />
          </Card>
          <Card className="overflow-clip">
            <CardHeader title="Activity" className={CARD_HEADER_CLASS} />
            <DocumentActivity key={document.status} document={document} />
          </Card>
        </div>
      </div>
    </>
  );
}
