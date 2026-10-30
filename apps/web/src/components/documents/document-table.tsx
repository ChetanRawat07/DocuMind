import type { DocumentDto } from '@documind/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { DOCUMENT_TYPE_LABEL } from '../../lib/document-labels';
import { documentDetailPath } from '../../lib/document-view';
import { fileExtensionLabel, formatBytes, formatRelativeTime } from '../../lib/format';
import { DocumentStatusBadge } from '../ui/status-badge';

/**
 * Documents as a table: name (linking to the detail page) with upload
 * time, type and status, plus optional size and per-row actions. Type and
 * size hide on small screens, and status moves under the name.
 */
export function DocumentTable({
  documents,
  caption,
  now,
  showSize = false,
  renderActions,
}: {
  documents: readonly DocumentDto[];
  caption: string;
  now: Date;
  showSize?: boolean;
  renderActions?: (document: DocumentDto) => ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-xs tracking-wide text-gray-500 uppercase">
          <tr className="border-b border-gray-100">
            <th scope="col" className="px-5 py-3 font-medium">
              Document
            </th>
            <th
              scope="col"
              className="hidden px-5 py-3 font-medium whitespace-nowrap sm:table-cell"
            >
              Type
            </th>
            {showSize ? (
              <th
                scope="col"
                className="hidden px-5 py-3 text-right font-medium whitespace-nowrap md:table-cell"
              >
                Size
              </th>
            ) : null}
            <th
              scope="col"
              className="hidden px-5 py-3 font-medium whitespace-nowrap sm:table-cell"
            >
              Status
            </th>
            {renderActions ? (
              <th scope="col" className="px-5 py-3">
                <span className="sr-only">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {documents.map((document) => (
            <tr key={document.id}>
              {/* w-full + max-w-0 lets the name column shrink so long filenames truncate. */}
              <td className="w-full max-w-0 px-5 py-3.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="grid size-9 shrink-0 place-items-center rounded-lg bg-gray-100 text-[0.625rem] font-bold text-gray-600"
                  >
                    {fileExtensionLabel(document.originalFilename)}
                  </span>
                  <div className="min-w-0">
                    <Link
                      to={documentDetailPath(document.id)}
                      title={document.originalFilename}
                      className="block truncate rounded-sm font-semibold text-gray-900 hover:text-brand-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                    >
                      {document.originalFilename}
                    </Link>
                    <p className="truncate text-xs text-gray-500">
                      Uploaded{' '}
                      <time dateTime={document.createdAt}>
                        {formatRelativeTime(document.createdAt, now)}
                      </time>
                    </p>
                    {/* Phones have no room for a status column; the badge sits under the name. */}
                    <div className="mt-1.5 sm:hidden">
                      <DocumentStatusBadge status={document.status} />
                    </div>
                  </div>
                </div>
              </td>
              <td className="hidden px-5 py-3.5 whitespace-nowrap text-gray-600 sm:table-cell">
                {document.documentType
                  ? DOCUMENT_TYPE_LABEL[document.documentType]
                  : 'Not classified'}
              </td>
              {showSize ? (
                <td className="hidden px-5 py-3.5 text-right whitespace-nowrap text-gray-600 tabular-nums md:table-cell">
                  {formatBytes(document.sizeBytes)}
                </td>
              ) : null}
              <td className="hidden px-5 py-3.5 sm:table-cell">
                <DocumentStatusBadge status={document.status} />
              </td>
              {renderActions ? (
                <td className="px-5 py-3.5 text-right whitespace-nowrap">
                  {renderActions(document)}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
