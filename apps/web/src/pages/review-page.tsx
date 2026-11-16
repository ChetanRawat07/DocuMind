import { ClipboardCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { DocumentTable } from '../components/documents/document-table';
import { LoadMore } from '../components/documents/load-more';
import { buttonClasses } from '../components/ui/button-styles';
import { Card, CardHeader } from '../components/ui/card';
import { EmptyState, ErrorState, SkeletonRows } from '../components/ui/feedback';
import { PageHeader } from '../components/ui/page-header';
import { NAV_ITEMS } from '../layout/navigation';
import { useDelayedLoading } from '../lib/delayed-loading';
import { documentDetailPath } from '../lib/document-view';
import { REVIEW_PAGE_SIZE, REVIEW_QUEUE } from '../services/page-queries';
import { useDocumentList } from '../services/use-document-list';

/**
 * Documents whose extraction needs a human check. Each opens on its detail
 * page, where the flagged fields sit beside the document itself.
 */
export function ReviewPage() {
  const [now] = useState(() => new Date());
  const list = useDocumentList(REVIEW_QUEUE, REVIEW_PAGE_SIZE);

  const load = useDelayedLoading(list.status === 'loading');

  let body;
  if (load.skeleton || list.status === 'loading') {
    body = (
      <SkeletonRows label="Loading the review queue…" stacked className={load.skeletonClass} />
    );
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
              viewTransition
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
      <Card className="overflow-clip">
        <CardHeader
          title="Waiting for review"
          description="Oldest first"
          className="border-b border-line px-4 py-3 sm:px-6"
        />
        {load.skeleton ? body : <div className={load.revealClass}>{body}</div>}
      </Card>
    </>
  );
}
