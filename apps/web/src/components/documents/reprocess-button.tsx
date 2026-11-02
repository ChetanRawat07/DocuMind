import { type DocumentDto, documentSchema, processingJobSchema } from '@documind/shared';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { SessionExpiredError } from '../../services/api-client';
import { useApi } from '../../services/use-api';
import { Button } from '../ui/button';

/** Documents a user may send back to processing; the API refuses the others with 409. */
const REPROCESSABLE: ReadonlySet<DocumentDto['status']> = new Set([
  'uploaded',
  'failed',
  'rejected',
]);

/** Queues the document for processing again, then reports its new state. */
export function ReprocessButton({
  document,
  onQueued,
}: {
  document: DocumentDto;
  onQueued: (document: DocumentDto) => void;
}) {
  const api = useApi();
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');

  if (!REPROCESSABLE.has(document.status)) return null;

  async function reprocess() {
    setState('busy');
    const path = `/documents/${encodeURIComponent(document.id)}`;
    try {
      await api.send('POST', `${path}/jobs`, {}, processingJobSchema);
      onQueued(await api.get(path, documentSchema));
      setState('idle');
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) setState('failed');
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {state === 'failed' ? (
        <span role="alert" className="text-xs text-red-700">
          Could not reprocess.
        </span>
      ) : null}
      <Button variant="secondary" disabled={state === 'busy'} onClick={() => void reprocess()}>
        <RotateCcw aria-hidden="true" className="size-4" />
        {state === 'busy' ? 'Queuing…' : 'Reprocess'}
      </Button>
    </span>
  );
}
