import type { DocumentDto } from '@documind/shared';
import { FileImage, FileText } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cx } from '../../lib/cx';
import { DOCUMENT_TYPE_LABEL } from '../../lib/document-labels';
import { documentDetailPath } from '../../lib/document-view';
import { formatBytes, formatRelativeTime } from '../../lib/format';
import { FOCUS_RING } from '../ui/button-styles';
import { DocumentStatusBadge } from '../ui/status-badge';
import { REVEAL_ON_HOVER, ROW, TABLE, TABLE_WRAP, TD, TH } from '../ui/table-styles';

/**
 * Documents as a table: name (linking to the detail page) with upload
 * time, type and status, plus optional size and per-row actions. Type and
 * size hide on small screens, and status moves under the name.
 * `revealActions` shows the actions only on row hover or focus; `pulse`
 * softly animates the dots of documents still processing (dashboard).
 */
export function DocumentTable({
  documents,
  caption,
  now,
  showSize = false,
  renderActions,
  revealActions = false,
  pulse = false,
}: {
  documents: readonly DocumentDto[];
  caption: string;
  now: Date;
  showSize?: boolean;
  renderActions?: (document: DocumentDto) => ReactNode;
  revealActions?: boolean;
  pulse?: boolean;
}) {
  return (
    <div className={TABLE_WRAP}>
      <table className={TABLE}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Document
            </th>
            <th scope="col" className={cx(TH, 'hidden w-36 sm:table-cell')}>
              Type
            </th>
            {showSize ? (
              <th scope="col" className={cx(TH, 'hidden w-24 text-right md:table-cell')}>
                Size
              </th>
            ) : null}
            <th scope="col" className={cx(TH, 'hidden w-32 sm:table-cell')}>
              Status
            </th>
            {renderActions ? (
              <th scope="col" className={cx(TH, 'w-0')}>
                <span className="sr-only">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => {
            const Icon = document.mimeType.startsWith('image/') ? FileImage : FileText;
            return (
              <tr key={document.id} className={ROW}>
                {/* w-full + max-w-0 lets the name column shrink so long filenames truncate. */}
                <td className={cx(TD, 'w-full max-w-0')}>
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="grid size-6 shrink-0 place-items-center rounded-md bg-surface-muted text-fg-muted"
                    >
                      <Icon className="size-3.5" />
                    </span>
                    <div className="min-w-0">
                      <Link
                        to={documentDetailPath(document.id)}
                        viewTransition
                        title={document.originalFilename}
                        className={cx(
                          'block truncate rounded-md font-medium text-fg hover:text-accent-fg hover:underline',
                          FOCUS_RING,
                        )}
                      >
                        {document.originalFilename}
                      </Link>
                      <p className="truncate text-xs text-fg-muted">
                        Uploaded{' '}
                        <time dateTime={document.createdAt}>
                          {formatRelativeTime(document.createdAt, now)}
                        </time>
                      </p>
                      {/* Phones have no room for a status column; the badge sits under the name. */}
                      <div className="mt-1 sm:hidden">
                        <DocumentStatusBadge status={document.status} animate={pulse} />
                      </div>
                    </div>
                  </div>
                </td>
                <td className={cx(TD, 'hidden whitespace-nowrap text-fg-secondary sm:table-cell')}>
                  {document.documentType
                    ? DOCUMENT_TYPE_LABEL[document.documentType]
                    : 'Not classified'}
                </td>
                {showSize ? (
                  <td
                    className={cx(
                      TD,
                      'hidden text-right whitespace-nowrap text-fg-secondary tabular-nums md:table-cell',
                    )}
                  >
                    {formatBytes(document.sizeBytes)}
                  </td>
                ) : null}
                <td className={cx(TD, 'hidden sm:table-cell')}>
                  <DocumentStatusBadge status={document.status} animate={pulse} />
                </td>
                {renderActions ? (
                  <td
                    className={cx(
                      TD,
                      'text-right whitespace-nowrap',
                      revealActions && REVEAL_ON_HOVER,
                    )}
                  >
                    {renderActions(document)}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
