import { type DocumentDto, documentSchema } from '@documind/shared';
import { ArrowLeft, FileSearch, FileX } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { DeleteDocumentButton } from '../components/documents/delete-document-button';
import { DocumentPreview } from '../components/documents/document-preview';
import { DownloadDocumentButton } from '../components/documents/download-document-button';
import { buttonClasses } from '../components/ui/button-styles';
import { Card, CardHeader } from '../components/ui/card';
import { EmptyState, ErrorState, Spinner } from '../components/ui/feedback';
import { PageHeader } from '../components/ui/page-header';
import { DocumentStatusBadge } from '../components/ui/status-badge';
import { NAV_ITEMS } from '../layout/navigation';
import { DOCUMENT_TYPE_LABEL, fileTypeLabel } from '../lib/document-labels';
import { formatBytes, formatDateTime } from '../lib/format';
import { ApiError } from '../services/api-client';
import { useApiQuery } from '../services/use-api-query';

const BACK_LINK_CLASS =
  'mb-4 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

function BackToDocuments() {
  return (
    <Link to={NAV_ITEMS.documents.path} className={BACK_LINK_CLASS}>
      <ArrowLeft aria-hidden="true" className="size-4" />
      All documents
    </Link>
  );
}

function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-3">
      <dt className="text-sm text-gray-500">{term}</dt>
      <dd className="text-right text-sm font-medium text-gray-900">{children}</dd>
    </div>
  );
}

function DocumentDetails({ document }: { document: DocumentDto }) {
  return (
    <dl className="divide-y divide-gray-100">
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
 * One document: its metadata, a preview of the file, download and delete.
 * Another user's document and a missing one look the same here, as in the API.
 */
export function DocumentDetailPage() {
  const { documentId = '' } = useParams();
  const navigate = useNavigate();
  const result = useApiQuery(`/documents/${encodeURIComponent(documentId)}`, documentSchema);

  if (result.status === 'loading') {
    return (
      <>
        <BackToDocuments />
        <PageHeader title="Document" />
        <Spinner label="Loading document…" className="py-10" />
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
                <Link to={NAV_ITEMS.documents.path} className={buttonClasses('secondary', 'sm')}>
                  Go to documents
                </Link>
              }
            />
          ) : (
            <ErrorState
              title="Could not load the document"
              description="Check your connection and try again."
              onRetry={result.retry}
            />
          )}
        </Card>
      </>
    );
  }

  const document = result.data;
  return (
    <>
      <BackToDocuments />
      <PageHeader
        title={document.originalFilename}
        description={`${fileTypeLabel(document.mimeType)} · ${formatBytes(document.sizeBytes)}`}
        actions={
          <>
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
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader title="Preview" className="border-b border-gray-100 px-5 py-4" />
          <DocumentPreview document={document} />
        </Card>
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <CardHeader title="Details" className="border-b border-gray-100 px-5 py-4" />
            <DocumentDetails document={document} />
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="Extracted data" className="border-b border-gray-100 px-5 py-4" />
            <EmptyState
              icon={FileSearch}
              title="No extracted data yet"
              description="Fields read from this document will appear here once processing is available."
            />
          </Card>
        </div>
      </div>
    </>
  );
}
