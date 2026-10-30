# Document management

The document workspace: list, search, filter, sort, a detail page, and authorized viewing and
downloading. Uploads and storage are covered in
[document-uploads.md](../storage/document-uploads.md); the decision to serve files through the API
is [ADR-016](../adr/016-file-access-through-the-api.md).

## Listing: `GET /api/v1/documents`

| Parameter | Values                                                                       | Default  |
| --------- | ---------------------------------------------------------------------------- | -------- |
| `q`       | Part of the filename, ignoring case; 1–100 characters; blank means no search | none     |
| `status`  | `uploaded`, `queued`, `processing`, `needs_review`, `completed`, `failed`    | all      |
| `type`    | `invoice`, `contract`, `purchase_order`, `unclassified`                      | all      |
| `format`  | `pdf` (application/pdf), `image` (image/png, image/jpeg)                     | all      |
| `sort`    | `newest`, `oldest`, `name_asc`, `name_desc`, `largest`, `smallest`           | `newest` |
| `limit`   | 1–100                                                                        | 20       |
| `cursor`  | `nextCursor` from the previous page, unchanged, with the same `sort`         | none     |

Filters combine with AND. Unknown values, a repeated parameter or an over-long search are a 400.
Every query is scoped to the caller (`WHERE user_id = $owner`), so no filter, search or cursor can
reach another user's rows.

### Search

- `ILIKE '%term%'` on `original_filename`. The term is a bound parameter, and `%`, `_` and `\`
  in it are escaped, so `100%` matches the literal text instead of everything.
- The term is normalized to Unicode NFC, the form filenames are stored in, so "É" typed as
  `E` + combining accent still matches.
- No index serves the substring match. The owner filter uses the
  `(user_id, created_at, id)` index first, so the match scans one user's rows only. A trigram
  index (`pg_trgm`) is the upgrade path if per-user volumes make this slow; measure first with
  `EXPLAIN ANALYZE`.

### Sorting and keyset pagination

Each sort orders by one column, then by `id`, so rows with equal values still have a fixed order.
The next page starts strictly after the last row seen:

```sql
WHERE user_id = $1 AND (sort_column, id) > ($last_value, $last_id)   -- '<' for descending
ORDER BY sort_column, id
LIMIT $limit + 1                                                      -- the extra row says "more"
```

- Unlike `OFFSET`, a page costs the same however deep it is, and rows inserted meanwhile do not
  shift page borders (no skipped or repeated rows).
- The cursor is base64url JSON of `{ sort, value, id }`. It is opaque to clients. A cursor made
  for a different sort is refused with a 400 rather than reinterpreted, because applying a
  filename position to a date ordering would silently skip or repeat rows. A forged cursor needs
  no signature: it can only move the starting point within the caller's own documents.
- `newest` and `oldest` walk the existing `(user_id, created_at DESC, id DESC)` index, forwards or
  backwards. Name and size orders sort the owner's matching rows in memory, which is cheap at
  per-user volumes. `created_at` has millisecond precision so it round-trips exactly through the
  cursor.
- Names sort with the ICU root collation (`COLLATE "und-x-icu"`): "alpha", "Beta", "Éclair",
  "zeta". The database default depends on the host's C library: the Alpine image used locally
  sorts by byte, which puts every capital letter before "a". Naming the collation makes the order
  the same everywhere, and the same in `ORDER BY` and in the cursor comparison.

## Viewing and downloading: `GET /api/v1/documents/:id/content`

`disposition=inline` for previews, `attachment` (default) for downloads.

1. Find the document with the owner filter. Not found or not yours: 404.
2. Open the stored object. A missing object is logged as an error (it means the upload write
   order was broken) and answered with a 500. No access is recorded.
3. Append the audit entry: `document.viewed` or `document.downloaded`, with the MIME type and size
   but not the filename. If this fails, the stream is closed and the request fails: no file is
   served without its audit entry. HEAD requests skip this step because they send no content.
4. Stream the file. Headers:
   - `Content-Type`: the type detected from the file's bytes at upload.
   - `Content-Length`: the stored object's size.
   - `Content-Disposition`: the original name in `filename*` (UTF-8, percent-encoded, RFC 8187),
     plus an ASCII `filename` fallback where quotes, backslashes, `%` and non-ASCII characters are
     replaced. The header cannot be broken out of.
   - `X-Content-Type-Options: nosniff` and the API's CSP (helmet), and `Cache-Control: no-store`
     like every API response.

If the storage read fails before the first byte, the client gets the standard 500 error body (all
file headers are removed first). If it fails mid-file, the connection is cut, so the client sees
fewer bytes than `Content-Length` promised and knows the download failed. If the client
disconnects, the storage stream is destroyed.

## Web client

### Documents page (`/documents`)

- Search box, Status, Type, Format and Sort selects. The view lives in the URL
  (`?q=acme&status=failed&sort=name_asc`), so it survives reloads and the Back button and can be
  shared. Each parameter is validated against the shared contract on its own; a stale or
  hand-edited value is dropped instead of breaking the page.
- Search runs 300 ms after typing pauses, or at once on Enter. Typing replaces the history entry
  instead of adding one per search.
- "Load more" pages belong to the list they were loaded for. Changing the view cancels a pending
  "load more", and a response or failure that still arrives for the old view is ignored, so it
  cannot overwrite the new view's pages.
- An upload appears at the top of the plain newest-first list at once. In any other view its
  position depends on the server's ordering and filters, so the list is fetched again.
- Distinct empty states: "No documents yet" and "No matching documents" (with Clear filters).
- A screen-reader status line announces how many documents are shown.
- On phones the type and size columns hide and the status badge moves under the filename.

### Detail page (`/documents/:id`)

- Metadata: status, document type, file type, size, upload, update and processing times.
- Preview: the file is fetched with the token and shown from a `blob:` URL typed with the
  API-detected MIME type, never the response header. Images use `<img>`. PDFs use `<object>`,
  whose fallback content (a download button) appears in browsers without an inline PDF viewer
  (common on mobile). The URL is revoked when the page closes.
- Download fetches with `disposition=attachment` and saves under the original name.
- Delete uses the inline confirmation, then returns to the list, replacing the history entry so
  Back does not lead to a deleted document.
- A 404 or a malformed id shows "Document not found". Another user's document looks the same.
- An "Extracted data" panel says honestly that extraction does not exist yet.

## Known limitations

- Substring search has no index (see above), and only filenames are searched. Searching document
  content needs text extraction (Phase 6).
- No total count of matches: paging is "load more".
- No rate limits on file reads (hardening phase).
- In development, React StrictMode runs effects twice, so one preview can record two
  `document.viewed` entries. Production builds do not.
- Cursors issued before this phase (without a `sort`) are rejected with a 400; clients reload the
  first page.
- Inline PDF rendering depends on the browser's built-in viewer and was checked in desktop Chrome
  only; mobile browsers vary. The download button is always available.
- Relative upload times ("5 minutes ago") are computed when the page opens and do not tick.
