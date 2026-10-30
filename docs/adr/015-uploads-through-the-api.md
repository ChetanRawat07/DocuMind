# ADR-015: Uploads go through the API; storage behind an adapter

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

ADR-003 put document files in private object storage (Cloudflare R2 in the demo). Phase 4 has to
decide how bytes reach the bucket and what backs storage locally. Constraints: files are PDFs and
images up to 10 MiB; the API runs on a free instance (512 MB RAM); every file must be validated by
content, not by what the browser claims; zero cost; MinIO, the usual local S3 emulator, stopped
publishing community Docker images in 2025 and its repository is archived.

## Decision

- The browser sends the file to `POST /api/v1/documents` as multipart. The API authenticates the
  request, parses it with explicit limits, validates size, filename, extension and magic bytes, and
  only then writes to storage and the database.
- Storage is an `ObjectStorage` interface with two adapters: `FilesystemStorage` for development
  and tests, and `S3Storage` (AWS SDK v3) for R2. Configuration picks one; production refuses the
  filesystem adapter.
- Write order: object before row on upload; row before object on delete (see
  [docs/storage/document-uploads.md](../storage/document-uploads.md)).

## Alternatives

- **Presigned PUT straight to R2:** spares the API bandwidth and memory, but the bytes land before
  they are validated, so it needs a pending state, a verification step that re-reads the object,
  cleanup of rejected and abandoned uploads, and a CORS rule on the bucket. Worth revisiting if
  files grow well beyond 10 MiB or traffic grows.
- **S3 emulator in Docker Compose (SeaweedFS, Garage):** dev would use the real S3 code path, at
  the cost of another container to run and patch.
- **Store bytes in PostgreSQL:** rejected in ADR-003.

## Trade-offs

- Each concurrent upload holds up to 10 MiB in API memory and uses API bandwidth.
- Local development does not exercise the S3 adapter; it is covered by unit tests with a mocked
  client and must be smoke-tested against R2 once credentials exist.
- The two writes are not atomic; orphaned objects are possible (never rows without objects).

## Consequences

- Validation lives in one place, before anything is stored.
- Tests run without network or credentials.
- Phase 5 (download/view) reads through the same adapter or issues short-lived signed GET URLs.
- An orphan sweep and upload rate limits belong to the hardening phase.
