import type { DocumentDto } from '@documind/shared';
import { uploadProblemOf } from '../lib/upload-checks';
import { ApiError, isAbortError, SessionExpiredError, type UploadOptions } from './api-client';

export type UploadStatus = 'invalid' | 'queued' | 'uploading' | 'done' | 'failed' | 'cancelled';

export interface UploadItem {
  readonly id: string;
  readonly file: File;
  readonly status: UploadStatus;
  /** 0 to 1 while uploading. */
  readonly progress: number;
  readonly error: string | null;
}

export type UploadFn = (file: File, options: UploadOptions) => Promise<DocumentDto>;

/**
 * Files waiting to upload, uploaded one at a time so a large batch neither
 * floods the API nor competes for the user's bandwidth. A plain store (not
 * React state) so it can be tested directly and read with
 * useSyncExternalStore. Every change replaces `items`, keeping snapshots
 * immutable.
 */
export class UploadQueue {
  private items: readonly UploadItem[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly controllers = new Map<string, AbortController>();
  private running = false;

  private onUploaded: (document: DocumentDto) => void = () => undefined;

  constructor(private readonly uploadFile: UploadFn) {}

  /** Sets the callback run after each successful upload. */
  setOnUploaded(callback: (document: DocumentDto) => void): void {
    this.onUploaded = callback;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): readonly UploadItem[] => this.items;

  /** Adds files; ones that fail the quick checks are listed as invalid and never sent. */
  add(files: Iterable<File>): void {
    const added = Array.from(files, (file): UploadItem => {
      const problem = uploadProblemOf(file);
      return {
        id: crypto.randomUUID(),
        file,
        status: problem ? 'invalid' : 'queued',
        progress: 0,
        error: problem,
      };
    });
    this.setItems([...this.items, ...added]);
    void this.run();
  }

  /** Stops an upload in progress, or takes a waiting file out of the line. */
  cancel(id: string): void {
    const controller = this.controllers.get(id);
    if (controller) {
      controller.abort();
      return;
    }
    if (this.find(id)?.status === 'queued') this.update(id, { status: 'cancelled' });
  }

  retry(id: string): void {
    const status = this.find(id)?.status;
    if (status === 'failed' || status === 'cancelled') {
      this.update(id, { status: 'queued', progress: 0, error: null });
      void this.run();
    }
  }

  remove(id: string): void {
    if (this.find(id)?.status === 'uploading') return;
    this.setItems(this.items.filter((item) => item.id !== id));
  }

  /** Removes finished, cancelled and invalid entries; keeps waiting, active and failed ones. */
  clearFinished(): void {
    this.setItems(
      this.items.filter(
        (item) =>
          item.status === 'queued' || item.status === 'uploading' || item.status === 'failed',
      ),
    );
  }

  /**
   * Stops the active upload and cancels every waiting file; used when the
   * page unmounts. The queue stays usable, because React's StrictMode
   * unmounts and remounts components once in development.
   */
  cancelAll(): void {
    this.setItems(
      this.items.map((item) =>
        item.status === 'queued' ? { ...item, status: 'cancelled' } : item,
      ),
    );
    for (const controller of this.controllers.values()) controller.abort();
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const next = this.items.find((item) => item.status === 'queued');
        if (!next) return;
        await this.uploadOne(next.id, next.file);
      }
    } finally {
      this.running = false;
    }
  }

  private async uploadOne(id: string, file: File): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.update(id, { status: 'uploading', progress: 0, error: null });
    try {
      const document = await this.uploadFile(file, {
        signal: controller.signal,
        onProgress: (progress) => {
          this.update(id, { progress });
        },
      });
      this.update(id, { status: 'done', progress: 1 });
      this.onUploaded(document);
    } catch (error) {
      if (isAbortError(error)) {
        this.update(id, { status: 'cancelled', progress: 0 });
      } else {
        this.update(id, { status: 'failed', progress: 0, error: messageFor(error) });
      }
    } finally {
      this.controllers.delete(id);
    }
  }

  private find(id: string): UploadItem | undefined {
    return this.items.find((item) => item.id === id);
  }

  private update(id: string, changes: Partial<Omit<UploadItem, 'id' | 'file'>>): void {
    this.setItems(this.items.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }

  private setItems(items: readonly UploadItem[]): void {
    this.items = items;
    for (const listener of this.listeners) listener();
  }
}

/**
 * The API's 4xx messages describe the file ("not a valid PDF file") and are
 * written to be shown. Anything else gets fixed text.
 */
function messageFor(error: unknown): string {
  if (error instanceof SessionExpiredError) return error.message;
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return error.message;
  if (error instanceof TypeError) return 'Network error. Check your connection and retry.';
  return 'Upload failed. Please retry.';
}
