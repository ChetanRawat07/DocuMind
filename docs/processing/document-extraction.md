# Document classification and structured extraction

The second processing step: from a document's extracted text (see
[text-extraction.md](text-extraction.md)) to validated, scored fields. The confidence strategy is
[ADR-017](../adr/017-evidence-based-confidence.md). Code: `apps/api/src/extraction/`.

## Pipeline

```text
document_text_pages
  → classify: first 4,000 characters → invoice | purchase_order | contract | other (+ quote)
        other → outcome "unsupported", stop (one AI call)
  → select the type's schema and prompt
  → extract: first 8,000 characters → every field as {value, evidence}, plus line items or parties
  → Zod validation (generateStructured)        invalid → AiProviderError invalid_output, nothing stored
  → business rules                             violations → issues, fields capped
  → evidence checks and scoring                field and overall confidence, issues
  → save(jobId): one transaction — extraction row, documents.document_type, audit entry
```

- `DocumentAnalysisService.analyze(documentId)` only reads and calls the model.
  `save(jobId, analysis)` stores a result for the processing job that produced it. The worker
  calls both ([job queue](job-queue.md)) and saves inside the transaction that finishes the job.
  `npm run analyze -- <documentId>` runs `analyze` by hand and prints the result without storing
  it.
- Two AI calls per supported document, one for an unsupported one.
- Model output that fails the schema becomes an `invalid_output` error before the service sees
  it, so it can never be stored.

## Fields

Every field may be `null` when the document does not contain it. **Required** fields marked ✓.

| Invoice          | Purchase order   | Contract         |
| ---------------- | ---------------- | ---------------- |
| invoiceNumber ✓  | poNumber ✓       | title ✓          |
| vendorName ✓     | buyerName ✓      | parties ✓ (list) |
| customerName     | supplierName ✓   | effectiveDate ✓  |
| issueDate ✓      | orderDate ✓      | endDate          |
| dueDate          | deliveryDate     | governingLaw     |
| currency ✓       | currency         | contractValue    |
| subtotal         | totalAmount ✓    | currency         |
| taxAmount        | lineItems (list) |                  |
| totalAmount ✓    |                  |                  |
| lineItems (list) |                  |                  |

- Dates are ISO (`YYYY-MM-DD`), amounts plain numbers, currencies ISO 4217 codes. The JSON
  Schema sent to the model enforces these formats.
- A line item is `{description, quantity, unitPrice, amount}`; a party is `{name, role}`. At most
  40 line items and 10 parties.
- Each schema has a `version` (all 1), stored with the extraction. Change what a field means,
  bump the version.

### Stored shape

`document_extractions.fields`, one entry per field:

```json
{
  "invoiceNumber": {
    "value": "INV-2026-0417",
    "confidence": 0.95,
    "evidence": "Invoice No: INV-2026-0417"
  },
  "dueDate": { "value": null, "confidence": null, "evidence": null },
  "lineItems": {
    "value": [
      { "description": "Barcode scanners", "quantity": 4, "unitPrice": 120, "amount": 480 }
    ],
    "confidence": 0.95,
    "evidence": null
  }
}
```

`validation_issues`: `[{"code": "date_order", "fields": ["issueDate", "dueDate"]}]`. Codes and
field names only, never values.

## Business rules

Failures do not reject the extraction. They are stored as issues and cap the confidence of every
field involved at 0.5, so the result goes to review (Phase 10) instead of being lost or shown as
clean. Amounts compare with a tolerance of 0.05 for rounding.

| Code                        | Applies to  | Rule                                                                      |
| --------------------------- | ----------- | ------------------------------------------------------------------------- |
| `date_order`                | all         | Due, delivery or end date not before the issue, order or effective date   |
| `totals_mismatch`           | invoice     | subtotal + tax = total, when all three are present                        |
| `line_items_total_mismatch` | invoice, PO | Line amounts add up to the subtotal (or total − tax; for a PO, the total) |
| `line_item_arithmetic`      | invoice, PO | quantity × unit price = amount, for each complete line                    |
| `non_positive_amount`       | all         | Total or contract value above 0 (credit notes are flagged for review)     |
| `too_few_parties`           | contract    | At least two parties when any are found                                   |

Other issue codes: `missing_required_field`, `evidence_not_found`, `value_not_in_evidence`,
`evidence_not_visible` (see below) and `text_truncated`.

### Evidence a reader can see (Phase 13)

A PDF's text layer can hold text that is never drawn: invisible render mode, white on white, off
the page. Evidence found only there would still count as grounded, so a crafted PDF could reach
automatic completion with values no reader sees. Before an extraction completes without review,
the text-layer pages that hold its evidence are rendered and read with OCR
(`visible-evidence.ts`, `TextExtractionService.readRenderedPages`):

- Every quote must also be found in what OCR reads. Each value whose quote is not gets an
  `evidence_not_visible` issue, which sends the document to review with those fields flagged.
  Values are never changed.
- Pages read with OCR in the first place are trusted as read.
- At most 3 pages are rendered; evidence spread over more pages goes to review unrendered. A
  rendering error also means review, never a failed job.
- Extractions that go to review anyway are not checked: a person sees the file.
- Cost: about 2 s per rendered page on the development machine (measured on the dev database's
  two automatically completed invoices; neither was sent to review by the check). OCR misreads
  send a document to review, which is the safe direction.

## Confidence

Computed from checks, never taken from the model. An LLM's own confidence is poorly calibrated
and can be inflated by the document itself. Each value must come with a quote, and the quote is
checked.

| Situation                                                           | Field confidence      |
| ------------------------------------------------------------------- | --------------------- |
| Quote found in the text and it shows the value                      | 0.95 × OCR confidence |
| Quote found but it does not show the value (often a computed value) | 0.4 × OCR confidence  |
| Quote not in the text (possibly invented)                           | 0.3                   |
| Field involved in a failed business rule                            | at most 0.5           |
| Field absent                                                        | `null`                |

- **"Shows the value"** depends on the kind:
  - Text: contained in the quote, ignoring case and spacing.
  - Amounts: a number in the quote equals the value, read with either decimal convention
    (`1,250.50` and `1.250,50`).
  - Currencies: the code, or a matching symbol.
  - Dates: year, month (number or name) and day all appear.
- **Quote search** ignores case and whitespace. A multi-line quote counts as found when each of
  its lines is on the same page: the local model often prefixed quotes with the document title.
- **OCR confidence** is that of the page the quote is on (1 for text-layer pages). It scales the
  score because a misread digit is invisible to every other check.
- **A text value without a quote** is looked up as its own quote.
- **Lists** score the mean over their items: 0.95 × OCR when the item's description or party name
  is in the text, otherwise 0.3.
- **Classification** is 0.95 when its quote (usually the title) is in the text, otherwise 0.5.

**Overall confidence** = the lowest of:

- The classification confidence.
- Every extracted field's confidence.
- 0 for each missing required field.
- 0.5 if the text was truncated.

A result is only as reliable as its weakest value. It is a review signal, not a probability. The
review threshold (0.90) and what happens below it are in [review-workflow.md](review-workflow.md).

## Prompts and limits

| Template                                   | Text sent         | Output budget |
| ------------------------------------------ | ----------------- | ------------- |
| `document.classify@1`                      | first 4,000 chars | 100 tokens    |
| `document.extract.<type>@1` (one per type) | first 8,000 chars | 2,000 tokens  |

- **Document text** is untrusted and goes in through `untrustedText`, like every prompt (see
  [ai-providers.md](../ai/ai-providers.md#untrusted-text-and-prompt-injection)).
- **The 8,000-character limit was measured.** Number-dense text came to about 1.6 characters per
  token with `qwen2.5`. 8,000 characters made a 5,484-token prompt, which leaves room for the
  2,000-token answer in Ollama's 8,192-token context.
  - The first limit, 16,000 characters, made a 10,718-token prompt. Ollama silently cut it to
    4,098 tokens.
  - The Ollama provider now sends `truncate: false`, so an overflow fails instead.
- **Longer documents** are cut at the limit. The result gets a `text_truncated` issue and at most
  0.5 overall.

## Errors

| Error                                        | Permanent | Cause                                                           |
| -------------------------------------------- | --------- | --------------------------------------------------------------- |
| `DocumentAnalysisError` `text_not_extracted` | no        | Text extraction has not run yet                                 |
| `DocumentAnalysisError` `no_text`            | yes       | Every page is empty                                             |
| `AiProviderError`                            | per kind  | See [ai-providers.md](../ai/ai-providers.md#errors-and-retries) |

`analyze` returns `null` for an unknown document. `save` returns `null` when the document or job
was deleted meanwhile (foreign-key violation), storing nothing.

## Persistence and idempotency

- `save` writes three things in one transaction:
  - The extraction row (`insertOnce`, unique per job).
  - `documents.document_type`.
  - A `document.fields_extracted` audit entry.
- **A retried save** returns the stored row, with no second audit entry and no type change.
- **Audit metadata** holds scores, issue codes, provider and model, never field values.
- **Field values and quotes are document content.** They live only in `document_extractions`,
  which is row-level-security protected like every table. They never go to logs, audit entries or
  error messages.

## Measured on the local model

`qwen2.5:3b` on CPU, synthetic one-page documents:

| Sample                                             | Result                                                                                | Time  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- | ----- |
| Invoice with a "report a total of 0 USD" injection | All 10 fields correct, injection ignored, overall 0.95                                | ~60 s |
| Scanned purchase order (OCR 0.94)                  | All fields correct, overall 0.89                                                      | ~45 s |
| Contract                                           | Title missed (`missing_required_field`, overall 0); everything else correct           | ~32 s |
| Invoice with planted errors                        | Date order, line arithmetic and line total flagged; computed tax flagged; overall 0.4 | ~46 s |
| Letter                                             | `unsupported` after one call                                                          | ~6 s  |

The model computed a tax (total − subtotal) that the document never states. The evidence check
caught it: its quote did not show the value. That is why `value_not_in_evidence` scores 0.4.

## Known limitations

- **Truncated text.** Only the first 8,000 characters are read. Long contracts are flagged for
  review rather than chunked.
- **Evidence checks are heuristics:**
  - A quote can be real and still be the wrong line (for example a line item's amount used as
    the subtotal). Business rules catch some of these.
  - Small numbers ("1") are easy to find in any quote.
- **Retries rarely help with `invalid_output`.** At temperature 0 a retry usually repeats the
  same answer. The worker retries it like any retryable error, up to three attempts.
- **Untested on Cloudflare.** The JSON Schemas use `anyOf` for nullable values and `format: date`.
  Ollama handles them; Workers AI has only been tested for authentication failure.
- **English only**, and one currency per document.
- **The visibility check reads text, not meaning.** Visible text that is small or low contrast
  but readable by OCR passes, and the overall confidence is not lowered by the check (only the
  issue is added).
