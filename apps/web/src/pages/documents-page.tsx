import { FileText, SearchX } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';
import { DocumentFilters } from '../components/documents/document-filters';
import { DeleteDocumentButton } from '../components/documents/delete-document-button';
import { DocumentTable } from '../components/documents/document-table';
import { UploadPanel } from '../components/documents/upload-panel';
import { Button } from '../components/ui/button';
import { Card, CardHeader } from '../components/ui/card';
import { EmptyState, ErrorState, Spinner } from '../components/ui/feedback';
import { PageHeader } from '../components/ui/page-header';
import { NAV_ITEMS } from '../layout/navigation';
import { DOCUMENT_SORT_LABEL } from '../lib/document-labels';
import {
  type DocumentView,
  documentViewFromParams,
  documentViewToParams,
  hasDocumentFilters,
} from '../lib/document-view';
import { useDocumentList } from '../services/use-document-list';

export const DOCUMENTS_PAGE_SIZE = 20;

function DocumentList({
  list,
  now,
  filtered,
  onClearFilters,
}: {
  list: ReturnType<typeof useDocumentList>;
  now: Date;
  filtered: boolean;
  onClearFilters: () => void;
}) {
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
  if (list.items.length === 0 && filtered) {
    return (
      <EmptyState
        icon={SearchX}
        title="No matching documents"
        description="Try a different search, or clear the filters."
        action={
          <Button variant="secondary" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        }
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
      <p role="status" className="sr-only">
        {list.hasMore
          ? `Showing the first ${list.items.length} documents.`
          : `${list.items.length} ${list.items.length === 1 ? 'document' : 'documents'}.`}
      </p>
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

/**
 * The document workspace: upload, then search, filter, sort and page through
 * documents. The view lives in the URL, so it survives a reload and the Back
 * button, and can be shared as a link.
 */
export function DocumentsPage() {
  const [params, setParams] = useSearchParams();
  const view = documentViewFromParams(params);
  const list = useDocumentList(view, DOCUMENTS_PAGE_SIZE);
  const [now] = useState(() => new Date());

  const showView = (next: DocumentView) => {
    setParams(documentViewToParams(next));
  };
  // Stable, so the search box's debounce timer is not restarted by unrelated renders.
  // Searching replaces the history entry: typing should not fill the Back button.
  const search = useCallback(
    (text: string) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          const q = text.trim();
          if (q) next.set('q', q);
          else next.delete('q');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

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
          description={DOCUMENT_SORT_LABEL[view.sort]}
          className="border-b border-gray-100 px-5 py-4"
        />
        <DocumentFilters view={view} onChange={showView} onSearch={search} />
        <DocumentList
          list={list}
          now={now}
          filtered={hasDocumentFilters(view)}
          onClearFilters={() => {
            showView({ sort: view.sort });
          }}
        />
      </Card>
    </>
  );
}
