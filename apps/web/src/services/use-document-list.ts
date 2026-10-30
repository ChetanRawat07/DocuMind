import {
  type DocumentDto,
  type DocumentListResponse,
  documentListResponseSchema,
} from '@documind/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type DocumentView, documentListPath, isDefaultDocumentView } from '../lib/document-view';
import { isAbortError, SessionExpiredError } from './api-client';
import { useApi } from './use-api';
import { useApiQuery } from './use-api-query';

export type DocumentListState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly retry: () => void }
  | {
      readonly status: 'success';
      readonly items: readonly DocumentDto[];
      readonly hasMore: boolean;
      readonly moreStatus: 'idle' | 'loading' | 'error';
      readonly loadMore: () => Promise<void>;
    };

/** Pages loaded with "load more" and uploads shown at once, for one list path. */
interface LocalPages {
  readonly path: string;
  readonly added: readonly DocumentDto[];
  readonly pages: readonly DocumentListResponse[];
  readonly status: 'idle' | 'loading' | 'error';
}

const emptyPages = (path: string): LocalPages => ({ path, added: [], pages: [], status: 'idle' });

/**
 * The user's documents in `view` (search, filters, order), with "load more"
 * paging. Local changes are layered over the fetched pages: a deleted
 * document disappears at once, and an upload appears at the top of the
 * plain newest-first list. In any other view the right place for a new
 * document is the server's call, so the list is fetched again.
 *
 * Extra pages belong to the list path they were loaded for: changing the
 * view starts from its first page and cancels a "load more" still running
 * for the old view, so its late response cannot land in the new one.
 */
export function useDocumentList(
  view: DocumentView,
  pageSize: number,
): DocumentListState & {
  add: (document: DocumentDto) => void;
  remove: (id: string) => void;
} {
  const api = useApi();
  const path = documentListPath(view, pageSize);
  const firstPage = useApiQuery(path, documentListResponseSchema);
  const { retry } = firstPage;
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [stored, setStored] = useState<LocalPages>(() => emptyPages(path));
  const local = stored.path === path ? stored : emptyPages(path);
  const isDefaultView = isDefaultDocumentView(view);

  const moreRequest = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      moreRequest.current?.abort();
    },
    [path],
  );

  /** Applies `change` to the current path's pages. */
  const update = useCallback(
    (change: (current: LocalPages) => LocalPages) => {
      setStored((previous) => change(previous.path === path ? previous : emptyPages(path)));
    },
    [path],
  );

  const add = useCallback(
    (document: DocumentDto) => {
      if (isDefaultView) {
        update((current) => ({ ...current, added: [document, ...current.added] }));
      } else {
        update(() => emptyPages(path));
        retry();
      }
    },
    [isDefaultView, path, retry, update],
  );
  const remove = useCallback((id: string) => {
    setRemoved((previous) => new Set(previous).add(id));
  }, []);

  const firstData = firstPage.status === 'success' ? firstPage.data : null;
  const cursor = (local.pages.at(-1) ?? firstData)?.nextCursor ?? null;

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    moreRequest.current?.abort();
    const controller = new AbortController();
    moreRequest.current = controller;
    update((current) => ({ ...current, status: 'loading' }));
    try {
      const page = await api.get(
        documentListPath(view, pageSize, cursor),
        documentListResponseSchema,
        {
          signal: controller.signal,
        },
      );
      // Checked as well as the signal: a response already on its way can still arrive.
      if (controller.signal.aborted) return;
      update((current) => ({ ...current, pages: [...current.pages, page], status: 'idle' }));
    } catch (error) {
      if (
        !controller.signal.aborted &&
        !isAbortError(error) &&
        !(error instanceof SessionExpiredError)
      ) {
        update((current) => ({ ...current, status: 'error' }));
      }
    }
  }, [api, cursor, pageSize, update, view]);

  const items = useMemo(() => {
    if (!firstData) return [];
    const seen = new Set<string>();
    return [
      ...local.added,
      ...firstData.items,
      ...local.pages.flatMap((page) => page.items),
    ].filter((document) => {
      if (seen.has(document.id) || removed.has(document.id)) return false;
      seen.add(document.id);
      return true;
    });
  }, [local.added, firstData, local.pages, removed]);

  if (firstPage.status === 'loading') return { status: 'loading', add, remove };
  if (firstPage.status === 'error') return { status: 'error', retry, add, remove };
  return {
    status: 'success',
    items,
    hasMore: cursor !== null,
    moreStatus: local.status,
    loadMore,
    add,
    remove,
  };
}
