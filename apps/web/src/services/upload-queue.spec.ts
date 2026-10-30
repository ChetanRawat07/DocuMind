import type { DocumentDto } from '@documind/shared';
import { describe, expect, it, vi } from 'vitest';
import { testDocument } from '../test/render-app';
import { ApiError, type UploadOptions } from './api-client';
import { UploadQueue } from './upload-queue';

const file = (name: string, size = 100) => new File([new Uint8Array(size)], name);

/** An upload function whose calls the test settles by hand. */
function controlledUploads() {
  const calls: {
    file: File;
    options: UploadOptions;
    resolve: (document: DocumentDto) => void;
    reject: (error: unknown) => void;
  }[] = [];
  const upload = vi.fn(
    (uploaded: File, options: UploadOptions) =>
      new Promise<DocumentDto>((resolve, reject) => {
        calls.push({ file: uploaded, options, resolve, reject });
        options.signal?.addEventListener('abort', () => {
          reject(new DOMException('cancelled', 'AbortError'));
        });
      }),
  );
  return { upload, calls };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function statuses(queue: UploadQueue) {
  return queue.getSnapshot().map((item) => `${item.file.name}:${item.status}`);
}

describe('UploadQueue', () => {
  it('uploads files one at a time, in order', async () => {
    const { upload, calls } = controlledUploads();
    const queue = new UploadQueue(upload);

    queue.add([file('a.pdf'), file('b.pdf')]);
    await flush();
    expect(statuses(queue)).toEqual(['a.pdf:uploading', 'b.pdf:queued']);
    expect(upload).toHaveBeenCalledTimes(1);

    calls[0]?.resolve(testDocument());
    await flush();
    expect(statuses(queue)).toEqual(['a.pdf:done', 'b.pdf:uploading']);
  });

  it('keeps files added during an upload waiting until it finishes', async () => {
    const { upload, calls } = controlledUploads();
    const queue = new UploadQueue(upload);
    queue.add([file('a.pdf')]);
    await flush();

    queue.add([file('b.pdf')]);
    await flush();
    expect(statuses(queue)).toEqual(['a.pdf:uploading', 'b.pdf:queued']);

    calls[0]?.resolve(testDocument());
    await flush();
    expect(statuses(queue)).toEqual(['a.pdf:done', 'b.pdf:uploading']);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('reports progress and notifies about each uploaded document', async () => {
    const { upload, calls } = controlledUploads();
    const queue = new UploadQueue(upload);
    const onUploaded = vi.fn();
    queue.setOnUploaded(onUploaded);
    const listener = vi.fn();
    queue.subscribe(listener);

    queue.add([file('a.pdf')]);
    await flush();
    calls[0]?.options.onProgress?.(0.4);
    expect(queue.getSnapshot()[0]?.progress).toBe(0.4);

    calls[0]?.resolve(testDocument());
    await flush();
    expect(onUploaded).toHaveBeenCalledWith(testDocument());
    expect(queue.getSnapshot()[0]).toMatchObject({ status: 'done', progress: 1 });
    expect(listener).toHaveBeenCalled();
  });

  it('never sends a file that fails the quick checks', async () => {
    const { upload } = controlledUploads();
    const queue = new UploadQueue(upload);

    queue.add([file('setup.exe'), file('empty.pdf', 0), file('huge.pdf', 10 * 1024 * 1024 + 1)]);
    await flush();

    expect(upload).not.toHaveBeenCalled();
    expect(queue.getSnapshot().map((item) => item.error)).toEqual([
      'Unsupported file type. Upload a PDF, PNG, or JPEG file.',
      'The file is empty.',
      'The file is larger than the 10 MB limit.',
    ]);
  });

  it('cancels the active upload and moves on to the next file', async () => {
    const { upload } = controlledUploads();
    const queue = new UploadQueue(upload);
    queue.add([file('a.pdf'), file('b.pdf')]);
    await flush();

    queue.cancel(queue.getSnapshot()[0]?.id ?? '');
    await flush();

    expect(statuses(queue)).toEqual(['a.pdf:cancelled', 'b.pdf:uploading']);
  });

  it('cancels a waiting file without sending it', async () => {
    const { upload } = controlledUploads();
    const queue = new UploadQueue(upload);
    queue.add([file('a.pdf'), file('b.pdf')]);
    await flush();

    queue.cancel(queue.getSnapshot()[1]?.id ?? '');

    expect(statuses(queue)).toEqual(['a.pdf:uploading', 'b.pdf:cancelled']);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'a 4xx rejection, shown as written',
      new ApiError(415, 'X', 'Not a valid PDF file.'),
      'Not a valid PDF file.',
    ],
    [
      'a server error, shown as fixed text',
      new ApiError(500, 'X', 'stack trace'),
      'Upload failed. Please retry.',
    ],
    [
      'a network failure',
      new TypeError('Failed'),
      'Network error. Check your connection and retry.',
    ],
  ])('fails with %s, and can be retried', async (_case, error, message) => {
    const { upload, calls } = controlledUploads();
    const queue = new UploadQueue(upload);
    queue.add([file('a.pdf')]);
    await flush();

    calls[0]?.reject(error);
    await flush();
    expect(queue.getSnapshot()[0]).toMatchObject({ status: 'failed', error: message });

    queue.retry(queue.getSnapshot()[0]?.id ?? '');
    await flush();
    expect(statuses(queue)).toEqual(['a.pdf:uploading']);
    expect(queue.getSnapshot()[0]?.error).toBeNull();
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('removes entries, but never one that is uploading', async () => {
    const { upload } = controlledUploads();
    const queue = new UploadQueue(upload);
    queue.add([file('a.pdf'), file('bad.exe')]);
    await flush();
    const [active, invalid] = queue.getSnapshot();

    queue.remove(active?.id ?? '');
    queue.remove(invalid?.id ?? '');

    expect(statuses(queue)).toEqual(['a.pdf:uploading']);
  });

  it('clears finished entries and keeps active and failed ones', async () => {
    const { upload, calls } = controlledUploads();
    const queue = new UploadQueue(upload);
    queue.add([file('done.pdf'), file('failed.pdf'), file('bad.exe'), file('waiting.pdf')]);
    await flush();
    calls[0]?.resolve(testDocument());
    await flush();
    calls[1]?.reject(new TypeError('offline'));
    await flush();

    queue.clearFinished();

    expect(statuses(queue)).toEqual(['failed.pdf:failed', 'waiting.pdf:uploading']);
  });

  it('cancels everything when the page goes away, and stays usable', async () => {
    const { upload } = controlledUploads();
    const queue = new UploadQueue(upload);
    queue.add([file('a.pdf'), file('b.pdf')]);
    await flush();

    queue.cancelAll();
    await flush();
    expect(statuses(queue)).toEqual(['a.pdf:cancelled', 'b.pdf:cancelled']);
    expect(upload).toHaveBeenCalledTimes(1);

    queue.add([file('c.pdf')]);
    await flush();
    expect(statuses(queue)).toContain('c.pdf:uploading');
  });
});
