# ADR-010: Data retention and erasure

- **Status:** Accepted
- **Date:** 2026-11-03

## Context

Documents are invoices, contracts and purchase orders: they carry names, addresses, amounts and
signatures. A user must be able to remove everything DocuMind holds about them. Identity lives in
Supabase (ADR-013); the API holds no service-role key, so it cannot delete the Supabase account.
Data spans PostgreSQL and object storage with no shared transaction (ADR-015). The audit log is
append-only and is also what the processing quota counts.

## Decision

- **Retention:** documents are kept until their owner deletes them, one at a time or all at once.
  There is no automatic expiry.
- **Erasure:** `DELETE /api/v1/me` ("Delete all my data" in Settings, confirmed by typing
  `DELETE`). One transaction locks the user row, deletes the user's documents (their text,
  extractions, reviews and jobs cascade), appends `user.data_erased` and deletes the user row.
  The files are then removed, ten at a time. A file that cannot be removed is logged as an orphan.
- **What remains:**
  - The Supabase account. The next request with a valid token provisions a new, empty profile.
  - The user's audit entries. They hold ids, action names, types, sizes and field names, never
    filenames, values or text, and they keep the processing quota honest.
- **Orphans:** `npm run storage:sweep` lists stored files that no document row references and
  are over 24 hours old (younger ones may belong to an upload still in flight). It deletes them
  only with `--delete`.

## Alternatives

- **Delete the Supabase account too.** Needs the service-role key in the API: one leaked
  environment variable would then give full control of every account. Deleting the account in
  Supabase stays a manual step for now.
- **Automatic expiry (delete after N days).** Not asked for by the product, and surprising for an
  archive of business documents. It can be added as a scheduled job with the same deletion path.
- **Delete the user's audit entries too.** Would erase the security trail and give the quota back.
  The entries hold no document content.
- **Soft delete (a `deleted_at` flag).** Keeps the personal data that erasure is meant to remove.
- **A scheduled sweep in the worker.** An unattended deleter of files; a misconfigured database
  connection (every file then looks unreferenced) could wipe storage. The CLI's dry run makes a
  person look first.

## Trade-offs

- Erasure is not atomic across systems. Rows go first, so nothing points at a missing file; a
  crash or storage error can leave unreferenced files, which expose nothing (only rows grant access)
  and are found by the sweep.
- Logs are not erased. They carry ids, codes and timings, never document content (ADR-019), and
  age out with the host's log retention.
- Supabase may keep its own backups and logs; that is outside this application.

## Consequences

- An upload in flight during an erasure either commits before the erasure deletes its document
  (both lock the user row), or fails on the missing user and removes its file.
- Erasing data does not reset the daily processing quota.
- Phase 16 should document the manual Supabase account deletion and schedule the sweep's dry run.
