# ADR-016: Document files are served through the API

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

Phase 5 adds viewing and downloading of stored documents. Files are private: only the owner may
read them, and each read should be auditable. The browser authenticates with a bearer token in the
`Authorization` header, which `<img src>`, `<object data>` and plain links cannot send. Files are
at most 10 MiB (ADR-015). Storage is either the local filesystem (development, tests) or R2.

## Decision

- `GET /api/v1/documents/:id/content?disposition=inline|attachment` streams the file from storage
  to the client. Ownership is enforced in SQL (the same owner filter as every document read), so
  another user's document is a 404.
- Before the first byte is sent, the access is written to the audit log (`document.viewed` for
  `inline`, `document.downloaded` for `attachment`). If the audit entry cannot be written, the
  file is not served. HEAD requests send no content and are not recorded.
- The web app fetches the file with its token, wraps it in a `Blob` typed with the MIME type the
  API detected at upload, and displays it from a `blob:` URL (image in `<img>`, PDF in the
  browser's viewer via `<object>`), or saves it under its original name.

## Alternatives

- **Short-lived presigned GET URLs from R2:** R2 would serve the bytes and the API would only sign
  URLs. Rejected for now: the filesystem driver has no equivalent, so it would need its own signed
  route; the URL is a bearer secret for its lifetime and can leak through browser history, logs or
  the Referer header; and the audit entry would record that a URL was issued, not that the file
  was read. Worth revisiting if file sizes or traffic grow enough that API bandwidth matters.
- **Cookie session for file routes:** would let plain links work, but adds a second
  authentication mechanism and CSRF concerns alongside the bearer tokens of ADR-013.

## Trade-offs

- Every view and download passes through the API, which pays the bandwidth and holds a stream per
  request (not the whole file: it is piped from storage).
- The browser holds the whole file in memory while it is shown (bounded by the 10 MiB upload
  limit).
- `blob:` URLs share the app's origin. That is acceptable because previews are limited to PDF and
  images whose bytes were checked at upload, the blob's type is set by the app rather than
  sniffed, and PDFs render in the browser's built-in viewer rather than as a page of the app.

## Consequences

- One authentication path and one audit point for every byte a user reads.
- Works identically with both storage drivers, so it is fully covered by local tests.
- Rate limiting of file reads belongs to the hardening phase, with upload limits.
