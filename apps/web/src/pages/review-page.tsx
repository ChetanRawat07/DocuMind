import { ClipboardCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { DocumentTable } from '../components/documents/document-table';
import { LoadMore } from '../components/documents/load-more';
import { buttonClasses } from '../components/ui/button-styles';
import { Card, CardHeader } from '../components/ui/card';
import { EmptyState, ErrorState, Spinner } from '../components/ui/feedback';
import { PageHeader } from '../components/ui/page-header';
import { NAV_ITEMS } from '../layout/navigation';
import type { DocumentView } from '../lib/document-view';
import { documentDetailPath } from '../lib/document-view';
import { useDocumentList } from '../services/use-document-list';

export const REVIEW_PAGE_SIZE = 20;

/** Oldest first: whatever has waited longest is reviewed next. */
const REVIEW_QUEUE: DocumentView = { status: 'needs_review', sort: 'oldest' };

/**
 * Documents whose extraction needs a human check. Each opens on its detail
 * page, where the flagged fields sit beside the document itself.
 */
export function ReviewPage() {
  const [now] = useState(() => new Date());
  const list = useDocumentList(REVIEW_QUEUE, REVIEW_PAGE_SIZE);

  let body;
  if (list.status === 'loading') {
    body = <Spinner label="Loading the review queue…" className="px-5 py-10" />;
  } else if (list.status === 'error') {
    body = (
      <ErrorState
        title="Could not load the review queue"
        description="Check your connection and try again."
        onRetry={list.retry}
      />
    );
  } else if (list.items.length === 0) {
    body = (
      <EmptyState
        icon={ClipboardCheck}
        title="Nothing to review"
        description="Extractions with uncertain fields will appear here. Confident ones complete on their own."
      />
    );
  } else {
    body = (
      <>
        <DocumentTable
          documents={list.items}
          caption="Documents waiting for review, oldest first"
          now={now}
          renderActions={(document) => (
            <Link
              to={documentDetailPath(document.id)}
              className={buttonClasses('secondary', 'sm')}
              aria-label={`Review ${document.originalFilename}`}
            >
              Review
            </Link>
          )}
        />
        <LoadMore list={list} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={NAV_ITEMS.review.label} description={NAV_ITEMS.review.description} />
      <Card className="overflow-hidden">
        <CardHeader
          title="Waiting for review"
          description="Oldest first"
          className="border-b border-gray-100 px-5 py-4"
        />
        {body}
      </Card>
    </>
  );
}
