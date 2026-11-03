# Analytics

The Analytics screen and the dashboard's cards show how processing and review went over the
last 7, 30 or 90 days. Code: `apps/api/src/analytics/analytics.repository.ts` (queries),
`packages/shared/src/analytics.ts` (contract), `apps/web/src/pages/analytics-page.tsx`.

## Decisions

- **Computed live:** each request aggregates over the window, so the numbers are always current
  and nothing has to be kept in sync. A daily rollup table would cost less per request, but its
  counters can drift from the rows and need backfill and repair.
- **Bounded:** every query starts from the user's documents processed in the window, at most 90
  days, through `documents_user_id_processed_at_idx`. No query reads the user's whole history.
- **Days in the viewer's timezone:** the browser sends its IANA timezone. Without it, a document
  processed at 1 a.m. in India would count toward the previous day.
- **Correction rate instead of "accuracy":** there is no ground truth to measure accuracy, and
  model confidence is the system grading itself (ADR-017). The correction rate is measured from
  people's reviews, and is labeled as such.
- **One snapshot:** all queries of a request run in one read-only `REPEATABLE READ` transaction,
  so the numbers agree with each other.

## Definitions

**Processed in the window:** documents whose processing reached an outcome since local midnight
`days − 1` days ago. Each document counts once, by its latest outcome: a rejected document that
was reprocessed counts by its new result.

| Metric                  | Definition                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Documents (uploaded)    | Documents created in the window                                                                                                                  |
| Processed               | Processed in the window: extracted (`needs_review`, `completed`, `rejected`) or `failed`                                                         |
| Success / failure rate  | Extracted ÷ processed, failed ÷ processed; null when nothing was processed                                                                       |
| Needs review            | Documents waiting for review now, whatever the window                                                                                            |
| Processing time         | Average and p95 of succeeded jobs of those documents, first start to finish (retries and backoff included)                                       |
| Document types          | Type of each processed document; failed documents are mostly `unclassified`                                                                      |
| Confidence distribution | Overall confidence of each extracted document's latest extraction, in buckets below 50%, 50–70%, 70–90% and 90% and above (the review threshold) |
| Review outcomes         | That extraction completed automatically, was approved after review, was rejected, or is waiting                                                  |
| Review rate             | Share of those extractions that needed a person: 1 − automatic ÷ extracted                                                                       |
| Correction rate         | Of the values people confirmed or corrected in extractions they approved, the share they changed                                                 |
| Processing volume       | Processed and failed documents per local day, every day of the window present                                                                    |

- **What the correction rate measures:** what review caught, not accuracy overall. Automatically
  completed extractions are not checked by anyone and are not in it, so a low correction rate
  does not show that automatic completion is safe.
- **How values are compared:** as JSON values, so `100` and `100.0` are the same number.
- **Rejected extractions are left out** of the correction rate: their values were never approved.

## API

`GET /api/v1/analytics?days=30&tz=Asia/Kolkata`

- `days` must be one of 7, 30 or 90 (default 30). Any other value is a 400.
- `tz` must be an IANA name (default `UTC`). The name is checked by the shared schema with
  `Intl`; a name Node knows but PostgreSQL does not (for example `US/Pacific-New`) is a 400 too,
  not a 500.
- The response covers only the signed-in user's documents.

## Query plans

Measured with `EXPLAIN ANALYZE` on 60,000 documents and jobs across three users over a year, for
one user's 30-day window (about 1,700 documents). The data was loaded in a transaction that was
then rolled back.

| Query                     | Plan                                                                                 | Time   |
| ------------------------- | ------------------------------------------------------------------------------------ | ------ |
| Processed documents       | Bitmap index scan on `documents_user_id_processed_at_idx`                            | ~1 ms  |
| Processing time (to jobs) | Hash join over a sequential scan of `processing_jobs`                                | ~18 ms |
| Same, hash join disabled  | Nested loop, index scan on `processing_jobs_document_id_created_at_idx` per document | ~26 ms |

At this size the planner prefers to scan all jobs. The per-document index path exists, and
should win as the jobs table grows. The planner's choice is cost-based, so Phase 15 should
re-measure at realistic volume.

## Known limitations

- **No admin view:** analytics are per user; there is no cross-user analytics view.
- **Volume chart:** shows processed counts per day; failures appear only in the failure rate.
- **Unbounded totals:** "Needs review" counts all waiting documents, through the
  `(user_id, status)` index.
- **Recalculated on every load:** results are not cached, so each page view runs the queries again.
