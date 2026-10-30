# Document uploads and storage

How a file gets from the browser into private object storage, what is checked on the way, and
how the database and storage stay consistent. Decisions: [ADR-003](../adr/003-object-storage-for-documents.md)
(object storage) and [ADR-015](../adr/015-uploads-through-the-api.md) (uploads through the API,
storage adapters).

## Flow

```text
Browser                         API (POST /api/v1/documents)                 Storage      PostgreSQL
  │ quick checks (type, size)     │                                            │              │
  │── multipart, Bearer token ───▶│ 1. auth guard (before the body is read)    │              │
  │   (XHR, progress events)      │ 2. multer: 1 file part, ≤ 10 MiB, in memory│              │
  │                               │ 3. validateUpload: size, filename,         │              │
  │                               │    extension, magic bytes = extension      │              │
  │                               │ 4. key = documents/{user}/{year}/{doc}/original.{ext}     │
  │                               │──────── put(key, bytes) ──────────────────▶│              │
  │                               │──────── BEGIN; insert document; audit; COMMIT ───────────▶│
  │                               │   (if the transaction fails: delete(key))  │              │
  │◀──────── 201 document ────────│                                            │              │
```

Deletion (`DELETE /api/v1/documents/:id`) runs the other way: one transaction deletes the row
(owner-filtered in SQL) and appends `document.deleted`; then the object is removed.

## What is validated

| Check           | Where                                    | Rule                                                                                                                                                                                         | Response               |
| --------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Authentication  | Global guard                             | Valid Supabase token; runs before multer reads the body                                                                                                                                      | 401                    |
| Multipart shape | multer limits                            | Exactly one part, named `file`; no other fields; ≤ 50 header pairs                                                                                                                           | 400                    |
| Size            | multer, then `validateUpload`            | 1 byte to 10 MiB. Multer stops reading at the limit, so memory per request is bounded                                                                                                        | 413 / 400 (empty)      |
| Filename        | `sanitizeFilename`                       | Last path segment only; Unicode NFC; control and format characters removed (e.g. U+202E, which can disguise `fdp.exe` as `exe.pdf`); ≤ 255 characters, extension kept. Used for display only | 400 if nothing remains |
| Extension       | `uploadFileTypeForName` (shared)         | `.pdf`, `.png`, `.jpg`, `.jpeg`                                                                                                                                                              | 415                    |
| Content         | `detectFileType`                         | Leading bytes: `%PDF-`, the 8-byte PNG signature, or `FF D8 FF`. Must match the extension                                                                                                    | 415                    |
| MIME type       | —                                        | The client's `Content-Type` is ignored; the stored type is the detected one                                                                                                                  | —                      |
| Storage path    | `documentStorageKey`, `assertStorageKey` | Built from validated UUIDs and the detected type only; adapters refuse any other key shape, and the filesystem adapter refuses paths outside its root                                        | 500 (bug)              |
| Ownership       | Repository                               | Every read and delete filters by `user_id` in SQL                                                                                                                                            | 404                    |

The PDF check is deliberately strict: the PDF specification lets readers skip junk before
`%PDF-`, but accepting that allows polyglot files (valid as two formats at once).

**Not checked (yet):** whether the whole file is well-formed (a file can start with `%PDF-` and be
corrupt), embedded JavaScript or other active content inside PDFs, and malware. DocuMind never
executes uploads; they are served with `Content-Disposition`, the detected `Content-Type` and
`X-Content-Type-Options: nosniff`, and previewed only as images or in the browser's PDF viewer (see
[document-management.md](../documents/document-management.md)). Parsing in Phase 6 must treat files
as hostile input.

## Storage keys

```text
documents/{userId}/{year}/{documentId}/original.{pdf|png|jpg}
```

- No user input: ids are server-generated UUIDs and the extension comes from the detected type.
- The user prefix lets a future account deletion remove all of a user's objects by prefix.
- `original` leaves room for derived files later (for example OCR output) beside it.

## Consistency between storage and the database

There is no transaction spanning both, so the write order decides what can go wrong:

| Operation | Order                                      | If the second step fails                                                  | Remaining risk                                |
| --------- | ------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------- |
| Upload    | object, then row + audit (one transaction) | object deleted, error returned                                            | crash between steps leaves an orphaned object |
| Delete    | row + audit (one transaction), then object | logged as `Orphaned object <key>`; the user still sees the delete succeed | orphaned object                               |

The design never produces a row pointing at a missing file. Orphans cost storage but expose
nothing, because only rows grant access. A periodic sweep that lists keys without rows is future
work (Phase 13).

## Storage drivers

| `STORAGE_DRIVER` | Use                                               | Notes                                                                                                                                                    |
| ---------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filesystem`     | Development and tests (default)                   | `STORAGE_FILESYSTEM_ROOT` (default `.data/storage`, git-ignored); files written via temp file + rename, mode `0600`. Refused when `NODE_ENV=production`. |
| `s3`             | Cloudflare R2 (demo) or any S3-compatible service | `S3_ENDPOINT`, `S3_REGION` (default `auto`), `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`                                                     |

### Cloudflare R2 setup (manual, once)

1. Create a bucket (for example `documind-documents`). Leave public access **off** and do not
   enable the `r2.dev` URL.
2. Create an R2 API token with **Object Read & Write** limited to that bucket.
3. Set `STORAGE_DRIVER=s3`, `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`,
   `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` in the API's environment (never in a
   `VITE_*` variable).
4. No bucket CORS rule is needed: the browser never talks to the bucket.

The S3 adapter is unit-tested against a mocked client; it has not yet been run against a real R2
bucket in this project. Do that once credentials exist, before relying on it.

## Web client

- The Documents page has a drop area and a "Choose files" button (the keyboard path), an upload
  queue and the document list with delete.
- Quick checks in the browser (`lib/upload-checks.ts`) use the same shared rules for instant
  feedback; the API repeats them and inspects the bytes.
- Files upload one at a time with progress (XMLHttpRequest, since fetch has no upload progress),
  and can be cancelled, retried or removed. The API's 4xx messages are shown as written; other
  failures get fixed text.
- Delete asks for confirmation inline in the row.

## Limits and known gaps

- 10 MiB per file; no per-user quota or rate limit yet (Phase 13). Concurrent uploads each hold up
  to 10 MiB in API memory.
- Duplicate files are stored again; no content hashing yet.
- New documents stay in `uploaded`; queuing for processing arrives in Phase 9.
