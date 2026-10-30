# Text extraction and OCR

The first processing step: turn a stored document into normalized text, page by page. The
decision and its trade-offs are [ADR-007](../adr/007-ocr-strategy.md). Code:
`apps/api/src/text-extraction/`.

## Pipeline

```text
stored file (object storage)
  ├─ PDF ─ open with pdf.js ── corrupt → unreadable_pdf · password → encrypted_pdf · > 50 pages → too_many_pages
  │        for each page, one at a time:
  │          text layer ≥ 20 visible characters → keep it            (method text_layer)
  │          otherwise → render at 200 DPI → Tesseract OCR           (method ocr, with confidence)
  └─ PNG / JPEG ─ read width × height from the header
                  > 25 megapixels → image_too_large · bad header → unreadable_image
                  otherwise → Tesseract OCR as page 1                 (method ocr)
  → normalize each page's text
  → one transaction: replace document_texts + document_text_pages, append audit entry
```

- **Per-page decision.** A PDF with typed pages and one scanned signature page uses the text layer
  where it exists and OCR only where needed. A "searchable PDF" (a scan with an OCR text layer
  already added) keeps its text layer.
- **One page at a time.** Pages are read, rendered and recognized sequentially, with one canvas
  reused for the whole document, so memory does not grow with page count. Each page costs about
  1.2 s of OCR on a developer machine.
- **Offline.** pdf.js fonts, CMaps (needed for CJK text layers) and image decoders, and the
  Tesseract model, all come from installed npm packages. Nothing is downloaded at run time, and no
  document leaves the server.

## Normalization

Every page's text goes through `normalizeExtractedText`, so the same document always yields the
same string, however it was read:

| Step                                            | Why                                                             |
| ----------------------------------------------- | --------------------------------------------------------------- |
| Unicode NFKC                                    | PDFs often contain ligatures ("ﬁ") and full-width letters       |
| `\r\n` and `\r` → `\n`                          | One line-break convention                                       |
| Tabs, non-breaking and other spaces → one space | Text runs are spaced inconsistently                             |
| Remove control and format characters            | Soft hyphens, zero-width spaces and bidi overrides break search |
| Trim lines, at most one blank line              | Layout whitespace carries no meaning for extraction             |

NFKC also turns "m²" into "m2" and "½" into "1⁄2". That is acceptable for invoices and contracts,
where the field values that matter are words and decimal numbers.

## Storage

`document_texts`, one row per document:

- `page_count`, `ocr_page_count`, `character_count`.
- `duration_ms`.
- `engine`, for example `pdf.js 6.4.299; tesseract.js 7.0.0 (eng 4.0.0_best_int)`, so a result
  can be traced to the versions that produced it.

`document_text_pages`, one row per page:

- `method`: `text_layer` or `ocr`.
- `text`: at most 100,000 characters.
- `ocr_confidence`: 0–1, present exactly for OCR pages (a `CHECK` enforces this).

Running extraction again replaces both rows in one transaction, so a retry can never leave a mix
of two runs. Deleting a document deletes its text (`ON DELETE CASCADE`). Both tables have row-level
security enabled with no policies, like every other table.

If the document is deleted while its text is being extracted, the insert fails on the foreign key.
The service treats that as "document gone" and returns `null`, storing nothing.

## Errors

`TextExtractionError` has a `failure` code and a `permanent` flag. The Phase 9 job runner uses the
flag to decide whether a retry can help.

| Failure              | Permanent | Cause                                                 |
| -------------------- | --------- | ----------------------------------------------------- |
| `unreadable_pdf`     | yes       | Not a parseable PDF (corrupt, truncated)              |
| `encrypted_pdf`      | yes       | Needs a password                                      |
| `too_many_pages`     | yes       | More than 50 pages                                    |
| `unreadable_image`   | yes       | PNG/JPEG header missing or corrupt                    |
| `image_too_large`    | yes       | More than 25 megapixels (decompression-bomb guard)    |
| `page_text_too_long` | yes       | A page with more than 100,000 characters              |
| `unsupported_type`   | yes       | Not a PDF, PNG or JPEG                                |
| `ocr_failed`         | no        | Tesseract failed (it may be the engine, not the file) |

Other errors are not classified here. A missing stored object surfaces as `ObjectNotFoundError`,
and database errors propagate. Error messages describe the file, never its content.

tesseract.js re-throws failed jobs as uncaught exceptions unless the worker has an `errorHandler`,
which would crash the API process. The engine installs one. A test feeding it a broken image fails
if that handler is ever removed, because Vitest fails runs that have unhandled errors.

## Audit

Each successful extraction appends `document.text_extracted`:

- Actor: `system`.
- Metadata: page count, OCR page count, character count and duration. Never text.

## Running it

Until the worker processes jobs (Phase 9), extraction is started by hand:

```bash
npm run extract -- <documentId>
# {"documentId":"…","pageCount":5,"ocrPageCount":5,"characterCount":989,"durationMs":6101}
```

The command prints counts only. The text is in `document_text_pages`. It exits with 1 for an
unknown document or a failed extraction, and prints the failure code and whether it is permanent.

## Measured resource use

Development machine, 5-page scanned PDF at 200 DPI:

| Measure                                 | Value                            |
| --------------------------------------- | -------------------------------- |
| Time                                    | about 6 s (about 1.2 s per page) |
| Peak RSS, extraction alone              | about 400 MB                     |
| RSS after 10 extractions in one process | levels off at about 450 MB       |
| Idle API process (pdf.js loaded)        | about 170 MB                     |
| OCR confidence, clean synthetic scan    | 0.95                             |
| OCR confidence, a photo with no text    | 0.34 (noise)                     |

Two changes came from these measurements:

- Rendering at 200 instead of 300 DPI: about 15% less memory and a third less time, with no loss
  of accuracy on the samples.
- Reusing one canvas: a canvas per page grew the process by about 30 MB a page.

The remaining footprint is mostly Tesseract's WebAssembly heap and native image buffers, outside
the V8 heap, so `--max-old-space-size` does not bound it.

## Known limitations

- English only.
- Text layers with broken font encodings (no Unicode mapping) come out as gibberish but count as
  text, so they are not OCR'd. Detecting that needs a quality heuristic or the AI step.
- No per-page timeout. A pathological page is bounded by the Phase 9 job lease.
- Tables and columns are flattened to lines. Layout-aware extraction is out of scope.
- Rotated scans are read as-is (Tesseract tolerates small skew; 90° rotations are not corrected).
- Extraction runs only via the CLI until Phase 9.
