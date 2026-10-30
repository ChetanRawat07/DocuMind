import { type DocumentDto, UPLOAD_FILE_TYPES } from '@documind/shared';
import { useCallback, useEffect, useState } from 'react';
import { documentContentPath } from '../lib/document-view';
import { SessionExpiredError } from './api-client';
import { useApi } from './use-api';

export type PreviewState =
  | { readonly status: 'unsupported' }
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly url: string };

/** Only types the upload rules allow are rendered; anything else is never previewed. */
const PREVIEWABLE_TYPES: readonly string[] = UPLOAD_FILE_TYPES.map((type) => type.mimeType);

/**
 * Loads a document's file for display and exposes it as a blob: URL. The
 * file needs the bearer token, so a plain <img src> or <object data> on the
 * API URL cannot load it. The blob is typed with the MIME type the API
 * detected from the file's bytes, never with what the browser might guess.
 * The URL is revoked when the document changes or the page closes, which
 * frees the memory.
 */
export function useDocumentPreview(document: DocumentDto): PreviewState & { retry: () => void } {
  const api = useApi();
  const { id, mimeType } = document;
  const previewable = PREVIEWABLE_TYPES.includes(mimeType);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; state: PreviewState } | null>(null);
  const key = `${id}#${attempt}`;

  useEffect(() => {
    if (!previewable) return;
    const controller = new AbortController();
    let url: string | null = null;
    api
      .getBlob(documentContentPath(id, 'inline'), { signal: controller.signal })
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(new Blob([blob], { type: mimeType }));
        setResult({ key, state: { status: 'ready', url } });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !(error instanceof SessionExpiredError)) {
          setResult({ key, state: { status: 'error' } });
        }
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [api, id, key, mimeType, previewable]);

  const retry = useCallback(() => {
    setAttempt((previous) => previous + 1);
  }, []);

  if (!previewable) return { status: 'unsupported', retry };
  const state = result?.key === key ? result.state : { status: 'loading' as const };
  return { ...state, retry };
}
