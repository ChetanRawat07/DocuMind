import type { DocumentDto } from '@documind/shared';
import { CircleCheck, CircleAlert, FileUp, RotateCw, X } from 'lucide-react';
import { type DragEvent, useEffect, useRef, useState } from 'react';
import { cx } from '../../lib/cx';
import { fileExtensionLabel, formatBytes } from '../../lib/format';
import { UPLOAD_ACCEPT, UPLOAD_LIMIT_LABEL, UPLOAD_TYPES_LABEL } from '../../lib/upload-checks';
import type { UploadItem, UploadQueue } from '../../services/upload-queue';
import { useUploadQueue } from '../../services/use-upload-queue';
import { Button } from '../ui/button';

const STATUS_TEXT: Record<UploadItem['status'], string> = {
  invalid: 'Not uploaded',
  queued: 'Waiting',
  uploading: 'Uploading',
  done: 'Uploaded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function UploadRow({ item, queue }: { item: UploadItem; queue: UploadQueue }) {
  const name = item.file.name;
  const percent = Math.round(item.progress * 100);
  const canCancel = item.status === 'queued' || item.status === 'uploading';
  const canRetry = item.status === 'failed' || item.status === 'cancelled';

  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-lg bg-gray-100 text-[0.625rem] font-bold text-gray-600"
      >
        {fileExtensionLabel(name)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p title={name} className="truncate text-sm font-semibold text-gray-900">
            {name}
          </p>
          <p className="shrink-0 text-xs text-gray-500 tabular-nums">
            {formatBytes(item.file.size)}
          </p>
        </div>
        {item.status === 'uploading' ? (
          <div
            role="progressbar"
            aria-label={`Uploading ${name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100"
          >
            <div
              className="h-full rounded-full bg-brand-600 transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
        ) : null}
        <p
          className={cx(
            'mt-1 flex items-start gap-1 text-xs',
            item.error
              ? 'text-red-700'
              : item.status === 'done'
                ? 'text-green-700'
                : 'text-gray-500',
          )}
        >
          {item.status === 'done' ? (
            <CircleCheck aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          ) : null}
          {item.error ? (
            <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          ) : null}
          {item.status === 'uploading'
            ? `Uploading… ${percent}%`
            : (item.error ?? STATUS_TEXT[item.status])}
        </p>
      </div>
      {/* Fixed width keeps the size column aligned whether one or two buttons show. */}
      <div className="flex w-20 shrink-0 justify-end gap-1">
        {canRetry ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Retry ${name}`}
            onClick={() => {
              queue.retry(item.id);
            }}
          >
            <RotateCw aria-hidden="true" className="size-4" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          aria-label={canCancel ? `Cancel ${name}` : `Remove ${name} from the list`}
          onClick={() => {
            if (canCancel) queue.cancel(item.id);
            else queue.remove(item.id);
          }}
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </li>
  );
}

/** Counts for the screen-reader summary; changes only when a status changes, not on progress. */
function summaryOf(items: readonly UploadItem[]): string {
  if (items.length === 0) return '';
  const count = (status: UploadItem['status']) =>
    items.filter((item) => item.status === status).length;
  const pending = count('queued') + count('uploading');
  const problems = count('failed') + count('invalid');
  return `${count('done')} uploaded, ${problems} with problems, ${pending} remaining.`;
}

/**
 * Drag-and-drop or file-picker upload with a visible queue. The drop area is
 * a convenience for pointer users; the "Choose files" button is the
 * keyboard- and screen-reader-accessible way in.
 */
export function UploadPanel({ onUploaded }: { onUploaded: (document: DocumentDto) => void }) {
  const { queue, items } = useUploadQueue(onUploaded);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // A file dropped outside the drop area would make the browser open it and
  // leave the app; ignore such drops while this panel is on screen.
  useEffect(() => {
    const ignore = (event: Event) => {
      event.preventDefault();
    };
    window.addEventListener('dragover', ignore);
    window.addEventListener('drop', ignore);
    return () => {
      window.removeEventListener('dragover', ignore);
      window.removeEventListener('drop', ignore);
    };
  }, []);

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    queue.add(event.dataTransfer.files);
  }

  const hasFinished = items.some(
    (item) => item.status === 'done' || item.status === 'cancelled' || item.status === 'invalid',
  );

  return (
    <div>
      <div
        onDragOver={handleDragOver}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={handleDrop}
        className={cx(
          'm-5 flex flex-col items-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors',
          dragging ? 'border-brand-500 bg-brand-50' : 'border-gray-200 bg-gray-50/60',
        )}
      >
        <span className="grid size-10 place-items-center rounded-full bg-brand-50 text-brand-600">
          <FileUp aria-hidden="true" className="size-5" />
        </span>
        <p className="mt-3 text-sm font-semibold text-gray-900">
          {dragging ? 'Drop to upload' : 'Drag files here'}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          {UPLOAD_TYPES_LABEL}, up to {UPLOAD_LIMIT_LABEL} each
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={() => input.current?.click()}
        >
          Choose files
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept={UPLOAD_ACCEPT}
          tabIndex={-1}
          aria-hidden="true"
          className="hidden"
          onChange={(event) => {
            if (event.target.files) queue.add(event.target.files);
            // Reset so choosing the same file again still fires a change.
            event.target.value = '';
          }}
        />
      </div>

      {items.length > 0 ? (
        <div className="border-t border-gray-100">
          <div className="flex items-center justify-between px-5 pt-3">
            <h3 className="text-xs font-semibold tracking-wide text-gray-500 uppercase">Uploads</h3>
            {hasFinished ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  queue.clearFinished();
                }}
              >
                Clear finished
              </Button>
            ) : null}
          </div>
          <ul aria-label="Uploads" className="divide-y divide-gray-100">
            {items.map((item) => (
              <UploadRow key={item.id} item={item} queue={queue} />
            ))}
          </ul>
        </div>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {summaryOf(items)}
      </p>
    </div>
  );
}
