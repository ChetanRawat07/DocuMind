import type { DocumentDto } from '@documind/shared';
import { DOCUMENT_TYPE_LABEL } from '../../lib/document-labels';
import { fileExtensionLabel, formatRelativeTime } from '../../lib/format';
import { DocumentStatusBadge } from '../ui/status-badge';

/** Documents as a table: name with upload time, type and status. The Type column hides on small screens. */
export function DocumentTable({
  documents,
  caption,
  now,
}: {
  documents: readonly DocumentDto[];
  caption: string;
  now: Date;
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
            <th scope="col" className="px-5 py-3 font-medium whitespace-nowrap">
              Status
            </th>
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
                    <p
                      title={document.originalFilename}
                      className="truncate font-semibold text-gray-900"
                    >
                      {document.originalFilename}
                    </p>
                    <p className="text-xs text-gray-500">
                      Uploaded{' '}
                      <time dateTime={document.createdAt}>
                        {formatRelativeTime(document.createdAt, now)}
                      </time>
                    </p>
                  </div>
                </div>
              </td>
              <td className="hidden px-5 py-3.5 whitespace-nowrap text-gray-600 sm:table-cell">
                {document.documentType
                  ? DOCUMENT_TYPE_LABEL[document.documentType]
                  : 'Not classified'}
              </td>
              <td className="px-5 py-3.5">
                <DocumentStatusBadge status={document.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
