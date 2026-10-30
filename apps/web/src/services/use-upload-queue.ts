import { type DocumentDto, documentSchema } from '@documind/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { type UploadItem, UploadQueue } from './upload-queue';
import { useApi } from './use-api';

/** One upload queue for the lifetime of the component; leaving the page cancels what is left. */
export function useUploadQueue(onUploaded: (document: DocumentDto) => void): {
  queue: UploadQueue;
  items: readonly UploadItem[];
} {
  const api = useApi();
  const [queue] = useState(
    () =>
      new UploadQueue((file, options) => api.upload('/documents', file, documentSchema, options)),
  );

  useEffect(() => {
    queue.setOnUploaded(onUploaded);
  }, [queue, onUploaded]);

  useEffect(
    () => () => {
      queue.cancelAll();
    },
    [queue],
  );

  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  return { queue, items };
}
