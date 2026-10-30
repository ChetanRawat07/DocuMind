import type { DocumentDto } from '@documind/shared';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { documentContentPath } from '../../lib/document-view';
import { SessionExpiredError } from '../../services/api-client';
import { useApi } from '../../services/use-api';
import { Button } from '../ui/button';

/** Long enough for every browser to start saving the file before its blob is released. */
const REVOKE_DELAY_MS = 30_000;

/**
 * Downloads the file under its original name. The request needs the bearer
 * token, so the file is fetched first and saved from a temporary blob: URL;
 * a plain link to the API could not authenticate.
 */
export function DownloadDocumentButton({
  document,
  variant = 'primary',
}: {
  document: DocumentDto;
  variant?: 'primary' | 'secondary';
}) {
  const api = useApi();
  const [state, setState] = useState<'idle' | 'downloading' | 'failed'>('idle');

  async function download() {
    setState('downloading');
    try {
      const blob = await api.getBlob(documentContentPath(document.id, 'attachment'));
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = document.originalFilename;
      link.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, REVOKE_DELAY_MS);
      setState('idle');
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) setState('failed');
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {state === 'failed' ? (
        <span role="alert" className="text-xs text-red-700">
          Download failed.
        </span>
      ) : null}
      <Button
        variant={variant}
        disabled={state === 'downloading'}
        aria-label={`Download ${document.originalFilename}`}
        onClick={() => void download()}
      >
        <Download aria-hidden="true" className="size-4" />
        {state === 'downloading' ? 'Downloading…' : state === 'failed' ? 'Try again' : 'Download'}
      </Button>
    </span>
  );
}
