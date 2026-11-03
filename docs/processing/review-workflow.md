# Review workflow

The last processing step: a person checks what the model was unsure of. The decisions are
recorded in [ADR-018](../adr/018-human-review-workflow.md). Scores come from
[document-extraction.md](document-extraction.md#confidence).

Code:

- `apps/api/src/review/review-fields.ts`: which fields are flagged, automatic completion, and
  correction checks. Pure functions.
- `apps/api/src/review/review.service.ts`: field review, approve and reject.
- `apps/api/src/review/extraction-reviews.repository.ts`: the `extraction_reviews` table.
- `apps/web/src/components/review/`: the review panel on the document page.
- `apps/web/src/pages/review-page.tsx`: the review queue.

## Lifecycle

```text
extraction stored (worker)
        │
        ├── overall ≥ 0.90, no issues, evidence visible ──> completed (approved automatically)
        │
        └── otherwise ──> needs_review
                              │  reviewer confirms or corrects each flagged field
                              ├── approve ──> completed (values final)
                              └── reject  ──> rejected ──> reprocess ──> queued ──> …
```

"Evidence visible": values grounded in a PDF's text layer must also be on the page as rendered
(an OCR check, [details](document-extraction.md#evidence-a-reader-can-see-phase-13)); otherwise
an `evidence_not_visible` issue sends the document to review.

| Document status | Meaning                                  | Reviewer can                               |
| --------------- | ---------------------------------------- | ------------------------------------------ |
| `needs_review`  | An extraction waits for a human          | Confirm or correct fields, approve, reject |
| `completed`     | Approved, automatically or by a reviewer | Read only                                  |
| `rejected`      | The reviewer found the result unusable   | Reprocess (`POST /documents/:id/jobs`)     |

## Flagged fields

A field **needs review** when:

- It scored below `REVIEW_CONFIDENCE_THRESHOLD` (0.90, in `packages/shared/src/review.ts`).
- Or a validation issue names it. A missing required field always has one.

Absent optional fields are not flagged. Approval is refused (409) until every flagged field has
been confirmed or corrected.

| Action    | Stores                                       | For                    |
| --------- | -------------------------------------------- | ---------------------- |
| `confirm` | The current value (the reviewer's, if any)   | Every field, lists too |
| `correct` | A new value, checked like the model's answer | Single-value fields    |

Corrections use the same rules as model output: ISO dates, numbers within ±10¹², three-letter
upper-case currency codes, text up to 300 characters. An empty value clears the field.

## Data

`extraction_reviews`, one row per extraction, created by the first field action or the decision:

```json
{ "totalAmount": { "value": 58000 }, "vendorName": { "value": "ABC Pvt Ltd" } }
```

- `decision` (`approved`/`rejected`), `decided_by` (null for an automatic approval), `decided_at`
  and an optional `reject_reason`.
- The model's output in `document_extractions` is never changed. The API returns both the
  current `value` and the `extractedValue`, and `corrected` says whether they differ.
- **Final values** of a completed document are the reviewer's values over the model's.

## API

| Method | Path                                         | Result                                         |
| ------ | -------------------------------------------- | ---------------------------------------------- |
| GET    | `/api/v1/documents/:id/extraction`           | Latest extraction with fields and review state |
| PUT    | `/api/v1/documents/:id/extraction/fields/:f` | Confirm or correct one field; the extraction   |
| POST   | `/api/v1/documents/:id/extraction/approve`   | The document, now `completed`                  |
| POST   | `/api/v1/documents/:id/extraction/reject`    | The document, now `rejected`                   |

- Every mutation sends `extractionId`, the extraction the reviewer is looking at.
- **404:** another user's document or a missing one (same response), no extraction yet, or a
  field the document type does not have.
- **400:** an invalid body, an invalid value, or a correction of a list.
- **409:** the document is no longer in review, the extraction is no longer the latest, or
  flagged fields are unchecked.
- The review queue is the document list: `GET /documents?status=needs_review&sort=oldest`.

## Concurrency

- Each action runs in one transaction that first locks the document row (`SELECT … FOR UPDATE`),
  so edits and decisions on a document run one at a time and see each other's results.
- **Two tabs, approve and reject at once:** exactly one wins; the other gets 409 (tested with
  four concurrent requests).
- **Reprocessed in the meantime:** a new extraction exists, so actions naming the old one get 409
  and the UI reloads.
- **Field writes merge** (`fields || new`) rather than replace, and a decision is stored only
  where none exists.

## Audit

| Action                    | Actor  | Metadata                                         |
| ------------------------- | ------ | ------------------------------------------------ |
| `document.field_reviewed` | user   | `extractionId`, `field`, `confirmed`/`corrected` |
| `document.approved`       | user   | `extractionId`, `correctedFields` (names)        |
| `document.approved`       | system | `extractionId`, `automatic: true`, confidence    |
| `document.rejected`       | user   | `extractionId`, `hasReason`                      |

Never values, and never the rejection reason: both may quote the document.

## The UI

- **Review** in the sidebar lists documents in review, oldest first.
- The document page shows the file beside its fields. Flagged fields are highlighted with the
  reason, the passage the model quoted, and Confirm and Edit buttons.
- Approve stays disabled, with the count of fields left, until every flagged field is checked.
- Scores are labeled as review signals. An uncertain document type gets a warning suggesting
  rejection.
- Failed, rejected and never-processed documents have a Reprocess button.

## Known limitations

- **Scalars only:** line items and parties cannot be edited.
- **No re-validation:** business rules are not rerun on corrected values, so stored issues stay.
- **Document type is not gated:** an uncertain type is shown, not required to be confirmed.
- **Final decisions:** there is no reopening a completed document; reprocessing is allowed only
  for rejected ones.
- **Automatic completion trusts grounded values:** a correct quote of the wrong line scores 0.95.
- **One reviewer per document:** the owner. There are no roles or assignments.
- **No live updates:** the queue does not refresh while documents finish processing.
