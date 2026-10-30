import { FileText } from 'lucide-react';
import { useState } from 'react';
import { DeleteDocumentButton } from '../components/documents/delete-document-button';
import { DocumentTable } from '../components/documents/document-table';
import { UploadPanel } from '../components/documents/upload-panel';
import { Button } from '../components/ui/button';
import { Card, CardHeader } from '../components/ui/card';
import { EmptyState, ErrorState, Spinner } from '../components/ui/feedback';
import { PageHeader } from '../components/ui/page-header';
import { NAV_ITEMS } from '../layout/navigation';
import { useDocumentList } from '../services/use-document-list';

export const DOCUMENTS_PAGE_SIZE = 20;

function DocumentList({ list, now }: { list: ReturnType<typeof useDocumentList>; now: Date }) {
  if (list.status === 'loading') {
    return <Spinner label="Loading documents…" className="px-5 py-10" />;
  }
  if (list.status === 'error') {
    return (
      <ErrorState
        title="Could not load documents"
        description="Check your connection and try again."
        onRetry={list.retry}
      />
    );
  }
  if (list.items.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No documents yet"
        description="Upload an invoice, contract or purchase order to get started."
      />
    );
  }
  return (
    <>
      <DocumentTable
        documents={list.items}
        caption="Your documents"
        now={now}
        showSize
        renderActions={(document) => (
          <DeleteDocumentButton document={document} onDeleted={list.remove} />
        )}
      />
      {list.hasMore || list.moreStatus === 'error' ? (
        <div className="flex flex-col items-center gap-2 border-t border-gray-100 px-5 py-4">
          {list.moreStatus === 'error' ? (
            <p role="alert" className="text-xs text-red-700">
              Could not load more documents.
            </p>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            disabled={list.moreStatus === 'loading'}
            onClick={() => void list.loadMore()}
          >
            {list.moreStatus === 'loading'
              ? 'Loading…'
              : list.moreStatus === 'error'
                ? 'Try again'
                : 'Load more'}
          </Button>
        </div>
      ) : null}
    </>
  );
}

export function DocumentsPage() {
  const list = useDocumentList(DOCUMENTS_PAGE_SIZE);
  const [now] = useState(() => new Date());

  return (
    <>
      <PageHeader title={NAV_ITEMS.documents.label} description={NAV_ITEMS.documents.description} />
      <Card id="upload">
        <CardHeader
          title="Upload documents"
          description="Files are stored privately. Processing will start automatically once it is available."
          className="px-5 pt-5"
        />
        <UploadPanel onUploaded={list.add} />
      </Card>
      <Card className="mt-4 overflow-hidden">
        <CardHeader
          title="All documents"
          description="Newest first"
          className="border-b border-gray-100 px-5 py-4"
        />
        <DocumentList list={list} now={now} />
      </Card>
    </>
  );
}
