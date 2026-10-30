import type { DocumentDto } from '@documind/shared';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ApiError, SessionExpiredError } from '../../services/api-client';
import { useApi } from '../../services/use-api';
import { Button } from '../ui/button';

type DeleteState = 'idle' | 'confirming' | 'deleting' | 'failed';

/**
 * Delete with an inline confirmation instead of a modal: the row asks
 * "Delete?" in place, which keeps focus and context where the user is.
 * A 404 means the document is already gone, which is what the user wanted.
 */
export function DeleteDocumentButton({
  document,
  onDeleted,
  showLabel = false,
}: {
  document: DocumentDto;
  onDeleted: (id: string) => void;
  /** A labeled secondary button instead of an icon, for page-level actions. */
  showLabel?: boolean;
}) {
  const api = useApi();
  const [state, setState] = useState<DeleteState>('idle');

  async function confirmDelete() {
    setState('deleting');
    try {
      await api.delete(`/documents/${document.id}`);
      onDeleted(document.id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        onDeleted(document.id);
      } else if (!(error instanceof SessionExpiredError)) {
        setState('failed');
      }
    }
  }

  if (state === 'idle') {
    return (
      <Button
        variant={showLabel ? 'secondary' : 'ghost'}
        size={showLabel ? 'md' : 'sm'}
        aria-label={`Delete ${document.originalFilename}`}
        onClick={() => {
          setState('confirming');
        }}
      >
        <Trash2 aria-hidden="true" className="size-4" />
        {showLabel ? 'Delete' : null}
      </Button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      {state === 'failed' ? (
        <span role="alert" className="text-xs text-red-700">
          Could not delete.
        </span>
      ) : (
        <span className="text-xs text-gray-600">Delete permanently?</span>
      )}
      <Button
        size="sm"
        className="bg-red-600 hover:bg-red-700"
        disabled={state === 'deleting'}
        aria-label={`Confirm deleting ${document.originalFilename}`}
        // Moving focus here lets keyboard users confirm or cancel at once.
        autoFocus
        onClick={() => void confirmDelete()}
      >
        {state === 'deleting' ? 'Deleting…' : state === 'failed' ? 'Retry' : 'Delete'}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={state === 'deleting'}
        onClick={() => {
          setState('idle');
        }}
      >
        Cancel
      </Button>
    </span>
  );
}
