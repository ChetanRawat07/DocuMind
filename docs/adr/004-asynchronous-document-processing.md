# ADR-004: Asynchronous document processing

- **Status:** Accepted (implementation in Phase 9)
- **Date:** 2026-10-26

## Context

Processing a document (text extraction, OCR, classification, AI extraction, validation) can take
seconds to minutes and depends on slow or unreliable services. Doing it inside the upload request
would hold connections open, hit platform request timeouts, lose work when the client disconnects
and make retries impossible to control.

## Decision

The upload request only validates the file, stores it, records the document and enqueues a
processing job, then returns. A separate worker process (ADR-001) claims jobs and runs the pipeline.
Clients observe progress through the document and job status APIs.

## Alternatives

- **Synchronous processing in the request.** Simplest, but fails on timeouts, blocks the API and has
  no retry story.
- **Fire-and-forget in the API process (an un-awaited promise).** Work is lost on crash or redeploy,
  with no record that it was ever started.

## Trade-offs

- The UI must handle intermediate states (queued, processing, failed) instead of a single response.
- Correctness now depends on idempotency, retries and stale-job recovery (ADR-005, ADR-008).

## Consequences

- Phase 0 provides only the worker process and its poll-loop skeleton; Phase 9 adds the job model
  and processing.
