# ADR-017: Evidence-based extraction confidence

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Phase 8 extracts fields from documents with a language model. Phase 10 sends uncertain results to
human review, so every field needs a confidence and the document needs an overall one. The plan
requires that "an LLM-generated confidence number" not be presented as objective truth, and that
invalid output never be stored as a valid extraction. The local model is small (3B parameters) and
was seen inventing values, such as a computed tax that the document does not state.

## Decision

- **No self-reported confidence.** The model returns each value with a quote from the document.
  Confidence is computed from checks:
  - Is the quote in the text?
  - Does it show the value?
  - How good was the OCR of the page it is on?
  - Did a business rule involving the field fail?

  The numbers and rules are in [document-extraction.md](../processing/document-extraction.md).

- **Business-rule failures are kept, flagged and capped** (at 0.5), not rejected. Schema failures
  are still rejected (`invalid_output`).
- **Overall confidence** is the minimum over the classification, every extracted field and each
  required field (0 when missing), capped at 0.5 when the text was truncated.
- **Stored with the result:** the issues (codes and field names), the classification confidence
  and both prompt versions, in new `document_extractions` columns.

## Alternatives

- **Model self-reported confidence:** cheapest, but poorly calibrated. A document can also say
  "this is certain".
- **Hybrid (self-reported averaged with checks):** more output tokens, still partly uncalibrated,
  harder to explain.
- **Token log-probabilities:** a better-grounded signal, but neither provider's structured mode
  exposes them consistently.
- **Rejecting business-rule failures:** genuine documents with arithmetic errors could never be
  processed, and the data would be lost instead of reviewed.
- **Mean instead of minimum overall:** one invented total would hide behind nine good fields.

## Trade-offs

- **The scores are rule-based**, not probabilities. Two documents scoring 0.95 are equally
  checked, not equally likely to be right.
- **Quotes cost output tokens** (about 10–20 per field) and get stored with the extraction.
  That is document content, kept in the same table as the values.
- **The matching is heuristic.** A correct quote of the wrong line passes it, and so does a
  number small enough to appear anywhere.
- **Minimum-based overall is strict.** A single weak optional field sends the document to review.

## Consequences

- Phase 10's review UI can show, for each field, the quote and why its score is low (the issue
  codes).
- Changing a confidence constant changes what goes to review. Tests pin the current values.
- Scores from different schema or prompt versions are comparable only via the stored versions.
