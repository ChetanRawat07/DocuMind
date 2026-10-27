# ADR-003: Object storage for document files

- **Status:** Accepted (implementation in Phase 4)
- **Date:** 2026-10-26

## Context

Uploaded documents are binary files (PDFs and images) that can be several megabytes. Storing them
as database blobs bloats the database, its backups and its free-tier storage quota, and makes every
file read go through the database connection pool.

## Decision

Document files are stored in private object storage (Cloudflare R2 in the demo deployment).
PostgreSQL stores only metadata, including a generated `storage_key`. Keys are built from generated
identifiers (for example `documents/{userId}/{year}/{documentId}/original.pdf`), never from
user-supplied filenames. Clients never receive storage credentials; access goes through the API's
authorization checks or short-lived signed URLs.

## Alternatives

- **PostgreSQL `bytea`/large objects.** Simple, transactional, but expensive in storage and backups
  and against the plan's explicit guidance.
- **Local disk on the API host.** Free hosts have ephemeral disks, and it cannot be shared between
  processes on different machines.

## Trade-offs

- A database row and an object can get out of sync (for example, a crash between the upload and the
  insert). Phase 4 must define the write order and a cleanup strategy for orphans.
- Deletion must remove both the metadata and the object.

## Consequences

- A storage abstraction is required so local development and tests do not depend on R2 directly.
