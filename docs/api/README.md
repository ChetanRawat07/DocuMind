# API reference

The DocuMind REST API, version 1. Every request and response shape here is a Zod schema in
[`packages/shared/src`](../../packages/shared/src). The API validates input with those schemas, and
the web app validates responses with them. When this page and the schemas disagree, the schemas
are right.

## Conventions

- **Base URL:** `/api/v1`. Locally that is `http://localhost:3000/api/v1`, or the web app's own origin
  through the Vite proxy. In the demo it is `https://<service>.onrender.com/api/v1`.
- **Authentication:** `Authorization: Bearer <Supabase access token>` on every route except the two
  health checks. The API checks the token's signature against Supabase's public keys (JWKS), its
  issuer, audience and expiry ([authentication](../security/authentication.md)). The first
  authenticated request creates the user's DocuMind record.
- **Ownership:** every route returns or changes only the caller's own data. Another user's document
  gets the same `404` as a document that does not exist.
- **Request ids:** every response carries an `X-Request-Id` header, which error bodies repeat as
  `error.requestId`. Use it to find the request in the logs ([observability](../operations/observability.md)).
  The API ignores an incoming `X-Request-Id`.
- **JSON:** bodies are JSON, except the upload (multipart) and the file download. Times are ISO 8601
  in UTC. Ids are UUIDs, except audit entry ids (a decimal string).
- **Caching:** every response has `Cache-Control: no-store`.
- **CORS:** only the origins in `CORS_ALLOWED_ORIGINS` may call the API from a browser.

### Errors

Every non-2xx response has the same body:

```json
{ "error": { "code": "NOT_FOUND", "message": "Document not found", "requestId": "7d5e1f0a-…" } }
```

- `code` is the HTTP status name: `BAD_REQUEST`, `UNAUTHORIZED`, `NOT_FOUND`, `CONFLICT`,
  `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `TOO_MANY_REQUESTS`, `INTERNAL_SERVER_ERROR`,
  `SERVICE_UNAVAILABLE`.
- `message` describes 4xx errors. Validation errors list each problem as `field: reason`, separated
  by `; `. Every 5xx gets a generic message: the cause is only in the server log.

| Status | When                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------ |
| 400    | Invalid query, body or path id (ids must be UUIDs)                                               |
| 401    | Missing, malformed, expired or wrongly signed token; `WWW-Authenticate: Bearer` is set           |
| 404    | Unknown route, or a resource that does not exist or is not yours                                 |
| 409    | The action does not fit the document's current state (see each endpoint)                         |
| 413    | Upload over 10 MiB                                                                               |
| 415    | Upload that is not a PDF, PNG or JPEG, or whose bytes do not match its extension                 |
| 429    | Over a rate limit or the daily processing quota                                                  |
| 503    | Readiness: the database does not answer. Authenticated routes: Supabase's keys cannot be fetched |

### Rate limits and quota

| Limit                  | Applies to                                       | Window            |
| ---------------------- | ------------------------------------------------ | ----------------- |
| 300 requests           | Every authenticated route, per user              | 1 minute          |
| 10 requests            | `POST /documents` and `POST /documents/:id/jobs` | 1 minute          |
| 50 processing requests | Uploads and reprocessing, per user               | 24 hours, rolling |

- Over a per-minute limit: `429` with `Retry-After` (seconds).
- Over the daily quota: `429` without `Retry-After`. The quota is counted from the audit log, so
  deleting documents does not give it back. Repeating a request for a document that is already
  queued does not count.
- The per-minute limits are kept in each API process's memory (one instance in the demo).

### Pagination

- `GET /documents` and `GET /audit-logs` page with a keyset cursor. Pass the response's `nextCursor`
  back as `cursor`, unchanged, with the same filters and sort. `nextCursor: null` means the last page.
  Pages stay consistent when rows are added, unlike offsets.
- Other lists return a fixed number of the newest items.

## Health

| Method | Path            | Response                                                                       |
| ------ | --------------- | ------------------------------------------------------------------------------ |
| GET    | `/health`       | `200 { "status": "ok", "timestamp" }` while the process serves HTTP (liveness) |
| GET    | `/health/ready` | The same when the database answers `SELECT 1`, otherwise `503` (readiness)     |

Both are public and reveal nothing else: no version, hostname or failing dependency.

## User

| Method | Path  | Response                                                                                                                                                                   |
| ------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/me` | `200` `{ id, email, displayName, createdAt }`                                                                                                                              |
| DELETE | `/me` | `204`. Erases the caller's documents (with their text, extractions, reviews and jobs), their files and their profile ([ADR-010](../adr/010-data-retention-and-erasure.md)) |

`DELETE /me` keeps the audit entries, which hold no document content, and records the erasure as
`user.data_erased`. It also keeps the Supabase sign-in account: signing in again starts an empty
profile.

## Documents

A **document** as returned by the API:

```json
{
  "id": "uuid",
  "originalFilename": "invoice-0042.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 48213,
  "documentType": "invoice",
  "status": "needs_review",
  "processedAt": "2026-11-04T09:12:44.120Z",
  "createdAt": "2026-11-04T09:11:02.004Z",
  "updatedAt": "2026-11-04T09:12:44.120Z"
}
```

- `status`: `uploaded`, `queued`, `processing`, `needs_review`, `completed`, `failed` or `rejected`
  ([lifecycle](../processing/review-workflow.md)).
- `documentType`: `invoice`, `contract`, `purchase_order`, or `null` until classified.
- The storage key and other internal fields are never returned.

### `POST /documents`: upload

Multipart form data with one part named `file`.

- Accepted: PDF, PNG or JPEG, at most 10 MiB, with a matching extension. The API checks the file's
  bytes, not the declared type ([uploads](../storage/document-uploads.md)).
- `201` with the document, already `queued`: the file is stored and a processing job is created in
  the same transaction.
- `400` no file, empty file or invalid filename; `413` too large; `415` wrong type or content;
  `429` limit or quota.

### `GET /documents`: list

| Query    | Values                                                             | Default  |
| -------- | ------------------------------------------------------------------ | -------- |
| `q`      | Part of the filename, any case (at most 100 characters)            | none     |
| `status` | One document status                                                | any      |
| `type`   | `invoice`, `contract`, `purchase_order` or `unclassified`          | any      |
| `format` | `pdf` or `image`                                                   | any      |
| `sort`   | `newest`, `oldest`, `name_asc`, `name_desc`, `largest`, `smallest` | `newest` |
| `limit`  | 1–100                                                              | 20       |
| `cursor` | `nextCursor` from the previous page                                | none     |

`200` `{ items: Document[], nextCursor: string | null }`. Filters combine with AND
([document management](../documents/document-management.md)).

### `GET /documents/:id`

`200` with the document, or `404`.

### `GET /documents/:id/content`: file

- `disposition=attachment` (default) downloads; `disposition=inline` displays (previews).
- `200` with the stored bytes, the stored `Content-Type`, `X-Content-Type-Options: nosniff` and a
  `Content-Disposition` with the original filename. Each view or download is written to the audit log.
- `404` if the document is missing or not yours.

### `DELETE /documents/:id`

`204`. The row goes first, in a transaction with its audit entry, then the file. `404` if not yours.

### `GET /documents/:id/activity`

`200` `{ items: AuditEntry[] }`: the document's 50 most recent audit entries, newest first (see
[Audit log](#audit-log)).

## Processing

A **job** as returned by the API:

```json
{
  "id": "uuid",
  "status": "queued",
  "stage": null,
  "attempts": 1,
  "maxAttempts": 3,
  "errorCode": "ai_timeout",
  "requestId": "7d5e1f0a-…",
  "textExtractionMs": 1840,
  "aiMs": null,
  "availableAt": "2026-11-04T09:14:00.000Z",
  "startedAt": "2026-11-04T09:12:01.000Z",
  "finishedAt": null,
  "createdAt": "2026-11-04T09:11:02.004Z"
}
```

- `status`: `queued`, `running`, `succeeded` or `failed` (permanently, the dead letter).
- `stage`: the step a running job is in. Today the worker sets `text_extraction` and `ai_extraction`.
- `errorCode`: the last failure's code, such as `ai_timeout`, `encrypted_pdf` or `no_text`. The
  stored message stays internal.
- While queued after a failure, `availableAt` is when the retry runs
  ([job queue](../processing/job-queue.md)).

| Method | Path                  | Response                                                                                                                                                                                            |
| ------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/documents/:id/jobs` | `200` `{ items: Job[] }`: the document's 20 most recent jobs                                                                                                                                        |
| POST   | `/documents/:id/jobs` | `202` with the queued job: reprocesses a `failed` or `rejected` document. Returns the active job if one exists. `409` if in review or completed                                                     |
| GET    | `/processing/jobs`    | `200` `{ items: (Job & { document: { id, originalFilename } })[] }`, newest first. `status` filter; `limit` 1–100, default 50                                                                       |
| GET    | `/processing/summary` | `200` with the queue now (`queued`, `running`, `oldestQueuedAt`) and the last 7 days: `succeeded`, `failed`, `failuresByCode`, and `average`/`p95` of `processingMs`, `textExtractionMs` and `aiMs` |

## Review

The latest **extraction** of a document, `GET /documents/:id/extraction`:

```json
{
  "id": "uuid",
  "documentType": "invoice",
  "overallConfidence": 0.82,
  "classificationConfidence": 0.97,
  "issues": [{ "code": "totals_mismatch", "fields": ["subtotal", "taxAmount", "totalAmount"] }],
  "fields": [
    {
      "name": "totalAmount",
      "kind": "amount",
      "required": true,
      "value": 1200,
      "extractedValue": 1200,
      "confidence": 0.62,
      "evidence": "Total due: 1,200.00 EUR",
      "issues": ["totals_mismatch"],
      "needsReview": true,
      "reviewed": false,
      "corrected": false
    }
  ],
  "aiProvider": "cloudflare",
  "aiModel": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "createdAt": "2026-11-04T09:12:44.000Z",
  "review": { "decision": null, "decidedBy": null, "decidedAt": null, "rejectReason": null }
}
```

- `confidence` is a rule-based review signal from the evidence, not a probability
  ([ADR-017](../adr/017-evidence-based-confidence.md)). A field below 0.90, missing although
  required, or named in an issue needs review.
- `value` is the reviewer's correction if there is one, otherwise the model's `extractedValue`.
- `review.decidedBy` is `system` when the extraction was confident enough to complete on its own.
- `404` if the document has no extraction yet.

Each write names the extraction the reviewer is looking at (`extractionId`). If a newer extraction
exists, the write is refused with `409`, so a decision never lands on a result nobody has seen.

| Method | Path                                      | Body                                                                                  | Response                                                                                   |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| PUT    | `/documents/:id/extraction/fields/:field` | `{ extractionId, action: "confirm" }` or `{ extractionId, action: "correct", value }` | `200` with the updated extraction. `value`: a string (≤ 300) or number, or `null` to clear |
| POST   | `/documents/:id/extraction/approve`       | `{ extractionId }`                                                                    | `200` with the document, now `completed`                                                   |
| POST   | `/documents/:id/extraction/reject`        | `{ extractionId, reason? }` (≤ 500 characters)                                        | `200` with the document, now `rejected`                                                    |

- `409`: the document is not in review, the extraction is stale, or (approve) a flagged field is
  still unchecked.
- `400`: the value does not fit the field's kind, or the field is a list (line items, parties),
  which can be confirmed but not corrected.
- `404`: unknown document or field name.
- Every review action is audited with the field names, never the values.

## Audit log

An **audit entry**:

```json
{
  "id": "1042",
  "occurredAt": "2026-11-04T09:12:44.000Z",
  "actor": "system",
  "action": "document.fields_extracted",
  "resourceType": "document",
  "resourceId": "uuid",
  "requestId": "7d5e1f0a-…",
  "metadata": {
    "jobId": "uuid",
    "documentType": "invoice",
    "schemaVersion": 1,
    "overallConfidence": 0.82,
    "issues": ["totals_mismatch"]
  }
}
```

`actor` is `user` for the caller's own actions and `system` for processing. `metadata` holds codes,
counts and field names, never document content.

`GET /audit-logs`: `200` `{ items: AuditEntry[], nextCursor }`, newest first. `limit` 1–100, default
50; `cursor` from the previous page.

## Analytics

`GET /analytics?days=30&tz=Asia/Kolkata`

- `days`: `7`, `30` (default) or `90`, counted in local days ending today.
- `tz`: an IANA timezone (default `UTC`). It decides where each day starts. `400` for an unknown name.
- `200` with document counts, success and failure rates, processing time (average and p95), document
  types, confidence buckets, review and correction rates, and the volume for each day
  ([analytics](../operations/analytics.md)). A rate is `null` when there is nothing to divide by.

## Example session

```sh
API=http://localhost:3000/api/v1
TOKEN=<access token from the signed-in web app's Supabase session>

curl -s "$API/me" -H "Authorization: Bearer $TOKEN"
curl -s "$API/documents" -H "Authorization: Bearer $TOKEN" -F file=@invoice.pdf      # 201, queued
curl -s "$API/documents/<id>/jobs" -H "Authorization: Bearer $TOKEN"                 # progress
curl -s "$API/documents/<id>/extraction" -H "Authorization: Bearer $TOKEN"           # after processing
curl -s -X POST "$API/documents/<id>/extraction/approve" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"extractionId":"<extraction id>"}'
```

Treat the token like a password: it grants the account's access until it expires.
