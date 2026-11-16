import type { DocumentListState } from '../../services/use-document-list';
import { Button } from '../ui/button';

/** "Load more" under a document list, with its loading and error states. */
export function LoadMore({ list }: { list: Extract<DocumentListState, { status: 'success' }> }) {
  if (!list.hasMore && list.moreStatus !== 'error') return null;
  return (
    <div className="flex flex-col items-center gap-2 border-t border-line px-4 py-3 sm:px-6">
      {list.moreStatus === 'error' ? (
        <p role="alert" className="text-xs text-danger-fg">
          Could not load more documents.
        </p>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        loading={list.moreStatus === 'loading'}
        onClick={() => void list.loadMore()}
      >
        {list.moreStatus === 'loading'
          ? 'Loading…'
          : list.moreStatus === 'error'
            ? 'Try again'
            : 'Load more'}
      </Button>
    </div>
  );
}
