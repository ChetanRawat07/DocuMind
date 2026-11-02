# ADR-018: Human review and automatic completion

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Phase 8 scores every extracted value from checks against the document (ADR-017). The scores are
review signals, not probabilities. Phase 10 has to decide:

- Which results may skip a human.
- How a reviewer fixes a value without losing what the model said.
- What happens when a result is unusable.
- How to stop approval without looking.

## Decision

- **Automatic completion:** an extraction completes on its own only when its overall confidence is
  at least `REVIEW_CONFIDENCE_THRESHOLD` (0.90) and it has no validation issues. Today that means
  every value was quoted from a text-layer page, or from OCR of 95% or better. The worker
  records an approval with no reviewer in the same transaction that stores the extraction.
- **Flagged fields:** a field needs a check when it scores below 0.90 or an issue names it,
  including a missing required field.
- **Approval gate:** each flagged field must be confirmed or corrected before approval. The API
  refuses an approval with unchecked flagged fields (409); the UI only mirrors the rule.
- **Corrections are stored apart** in `extraction_reviews`, one row per extraction. The model's
  output in `document_extractions` never changes, so both stay auditable. The current value is
  the reviewer's when there is one.
- **Scalars only:** single values can be corrected. Line items and parties can be confirmed but
  not edited.
- **Rejection is its own outcome:** a new document status `rejected`, distinct from `failed`. A
  rejected document can be reprocessed like a failed one, which creates a new extraction to
  review.
- **Decisions are final:** after approval or rejection nothing can be edited.
- **Concurrency:** every review action locks the document row and names the extraction it acts
  on. A stale extraction or a document no longer in review gets a 409. The decision is also
  stored only where none exists.
- **Audit:** field actions, approvals and rejections are audited with field names and counts,
  never values or the rejection reason, which may quote the document.

## Alternatives

- **Review everything.** Safe, but the scores would then have no effect, and every clean invoice
  costs a human.
- **Score alone, issues ignored.** Any issue already caps the score at 0.5, so the result would
  differ only for missing optional fields. Requiring no issues states the rule directly.
- **Approve without a gate.** Fewer clicks, but a low-confidence value could become final without
  anyone reading it.
- **Edit the extraction in place, or store a new extraction version per edit.** In place loses the
  model's output. Versions mix the model's provenance with human edits and multiply rows.
- **Reuse `failed` for rejection.** No migration, but a rejected result would count as a
  processing failure in lists and in Phase 12's rates.
- **List editing.** A table editor for line items is a sizable UI of its own; reprocessing or
  rejection covers wrong lists for now.

## Trade-offs

- **The threshold is a judgment call.** 0.90 sits between "quoted and shown on a clean page"
  (0.95) and anything weaker. Changing it changes what reaches people; tests pin it.
- **Wrong but grounded values pass.** A correct quote of the wrong line scores 0.95, so an
  automatically completed extraction can still be wrong. Business rules catch some of these.
- **The document type itself is not a reviewable field.** An uncertain type (0.5) sends the
  document to review and is flagged in the UI, but the gate does not require confirming it.
- **Corrections are not re-checked by business rules.** A corrected total does not clear the
  stored `totals_mismatch` issue.

## Consequences

- The workflow is described in
  [docs/processing/review-workflow.md](../processing/review-workflow.md).
- Phase 12 can compute review and automatic-completion rates from `extraction_reviews`.
