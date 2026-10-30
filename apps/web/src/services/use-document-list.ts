import {
  type DocumentDto,
  type DocumentListResponse,
  documentListResponseSchema,
} from '@documind/shared';
import { useCallback, useMemo, useState } from 'react';
import { SessionExpiredError } from './api-client';
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

/**
 * The user's documents, newest first, with "load more" paging. Local changes
 * are layered over the fetched pages: an upload is shown at the top at once
 * and a deleted document disappears, without refetching.
 */
export function useDocumentList(pageSize: number): DocumentListState & {
  add: (document: DocumentDto) => void;
  remove: (id: string) => void;
} {
  const api = useApi();
  const firstPage = useApiQuery(`/documents?limit=${pageSize}`, documentListResponseSchema);
  const [added, setAdded] = useState<readonly DocumentDto[]>([]);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [more, setMore] = useState<{
    pages: readonly DocumentListResponse[];
    status: 'idle' | 'loading' | 'error';
  }>({ pages: [], status: 'idle' });

  const add = useCallback((document: DocumentDto) => {
    setAdded((previous) => [document, ...previous]);
  }, []);
  const remove = useCallback((id: string) => {
    setRemoved((previous) => new Set(previous).add(id));
  }, []);

  const firstData = firstPage.status === 'success' ? firstPage.data : null;
  const cursor = (more.pages.at(-1) ?? firstData)?.nextCursor ?? null;

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setMore((previous) => ({ ...previous, status: 'loading' }));
    try {
      const page = await api.get(
        `/documents?limit=${pageSize}&cursor=${encodeURIComponent(cursor)}`,
        documentListResponseSchema,
      );
      setMore((previous) => ({ pages: [...previous.pages, page], status: 'idle' }));
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) {
        setMore((previous) => ({ ...previous, status: 'error' }));
      }
    }
  }, [api, cursor, pageSize]);

  const items = useMemo(() => {
    if (!firstData) return [];
    const seen = new Set<string>();
    return [...added, ...firstData.items, ...more.pages.flatMap((page) => page.items)].filter(
      (document) => {
        if (seen.has(document.id) || removed.has(document.id)) return false;
        seen.add(document.id);
        return true;
      },
    );
  }, [added, firstData, more.pages, removed]);

  if (firstPage.status === 'loading') return { status: 'loading', add, remove };
  if (firstPage.status === 'error') return { status: 'error', retry: firstPage.retry, add, remove };
  return {
    status: 'success',
    items,
    hasMore: cursor !== null,
    moreStatus: more.status,
    loadMore,
    add,
    remove,
  };
}
