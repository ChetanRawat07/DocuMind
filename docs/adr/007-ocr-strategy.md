# ADR-007: Text extraction with pdf.js and tesseract.js

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

Phase 6 turns stored documents (PDF, PNG, JPEG; ADR-015) into text for the AI steps that follow.
Many PDFs have a text layer; scanned ones are images and need OCR; some mix both. The demo runs
the worker inside the API on Render's free instance (512 MB RAM, 0.1 CPU; ADR-009), whose native
Node runtime cannot install system packages. Everything must be free and work offline: no
document may leave the server for an external OCR service.

## Decision

- **PDF:** pdf.js (`pdfjs-dist`) reads each page's text layer. A page with fewer than 20 visible
  characters is treated as scanned: it is rendered at 200 DPI with `@napi-rs/canvas` and OCR'd.
  The decision is per page, so mixed PDFs work.
- **OCR:** tesseract.js (Tesseract compiled to WebAssembly) with the English LSTM model
  (`4.0.0_best_int`), loaded from the `@tesseract.js-data/eng` npm package, never from its default
  CDN. One engine per document, released afterwards.
- **Limits:** at most 50 pages per PDF, 25 megapixels per image (checked from the header before
  decoding), and the same cap for images embedded in PDFs (`maxImageSize`).
- **Storage:** normalized text per page in `document_text_pages` (method `text_layer` or `ocr`,
  OCR confidence), with a summary row in `document_texts`.
- **Errors:** a typed `TextExtractionError` with a `permanent` flag (corrupt, encrypted or
  oversized files are permanent; OCR engine failures are retryable) for the Phase 9 job runner.

## Alternatives

- **Native poppler and Tesseract binaries:** faster and more memory-efficient, but every
  environment would need them installed: a Dockerfile for Render, apt steps in CI, and setup for
  each developer. Worth reconsidering in Phase 16 together with the deployment target.
- **A hosted OCR API (cloud vision services):** better accuracy, but documents would leave the
  system, it costs money beyond free tiers, and it needs network access in tests.
- **OCR every page:** simpler, but much slower and less accurate than an existing text layer.

## Trade-offs

- **Memory.** Measured on a 5-page scanned PDF:
  - Extraction peaks at about 400 MB RSS. Repeated runs in one process level off at about 450 MB:
    native allocator retention, not an unbounded leak.
  - An idle API process is about 170 MB, of which loading pdf.js is roughly 80 MB.
  - OCR inside the 512 MB demo instance therefore has little headroom. Phase 9/16 must choose:
    run the worker elsewhere, process one page per job, or switch to native binaries.
- **Speed:** about 1.2 s per scanned page on a developer machine. A 0.1 CPU instance will be many
  times slower, so OCR must stay in the background (ADR-004).
- 200 DPI instead of Tesseract's recommended 300: on our samples it was just as accurate, with
  about 15% less memory and a third less time. Very small print may suffer.
- English only. Other languages need their model files and more memory.
- OCR on photos and poor scans returns low-confidence noise. The stored confidence lets later
  phases refuse it rather than trust it.

## Consequences

- Extraction runs anywhere Node runs, including CI, with no system dependencies and no network.
- Tests use real pdf.js and Tesseract on documents generated in code.
- Phase 8 reads per-page text and confidence. Phase 9 calls `TextExtractionService` from the
  worker and uses `permanent` to decide on retries.
