import type { DocumentContentDisposition } from '@documind/shared';

/**
 * A Content-Disposition header value (RFC 6266) for a user-supplied filename.
 * `filename*` carries the exact name, percent-encoded as UTF-8 (RFC 8187);
 * `filename` is an ASCII fallback for old clients. Neither can break out of
 * the header: quotes, backslashes, percent signs and anything outside
 * printable ASCII are replaced or encoded. (Stored names have no control
 * characters anyway; upload validation strips them.)
 */
export function contentDisposition(
  disposition: DocumentContentDisposition,
  filename: string,
): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
