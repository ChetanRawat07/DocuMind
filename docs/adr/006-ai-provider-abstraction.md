# ADR-006: AI provider abstraction

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Phases 8–10 classify documents and extract fields with a large language model. Development must
work offline and free on a laptop. The hosted demo must cost nothing (ADR-009) and cannot run a
model itself on a 512 MB instance. Business logic must not care which model answers, and switching
provider must need no code or frontend change.

## Decision

- **One interface.** `AiProvider.generate(request)` takes system and user messages, an optional
  JSON Schema, an output-token limit, a temperature and an optional abort signal. It returns text
  plus provider, model, token counts and latency. Phase 8 depends on it alone.
- **Two implementations, chosen by `AI_PROVIDER`:**
  - `OllamaProvider`: local, `qwen2.5:3b`, Ollama in an optional Docker Compose profile.
  - `CloudflareProvider`: Workers AI REST API, `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
  - Production must name the provider explicitly.
- **Plain `fetch`, no SDKs.** Each provider is one HTTP call. Both are tested against a stubbed
  `fetch`.
- **Structured output:**
  - The template's Zod schema is converted to JSON Schema and sent to the provider's constrained
    mode: Ollama `format`, Cloudflare `response_format: json_schema`.
  - The answer is always parsed and validated with Zod afterwards, because neither provider
    guarantees conformance.
- **Errors:**
  - Normalized to `AiProviderError` with a `kind`: `timeout`, `rate_limited`, `unavailable`,
    `invalid_output`, `authentication` or `invalid_request`.
  - A `retryable` flag and the provider's `Retry-After` hint go with it.
  - Providers never retry themselves; the job runner does (Phase 9).
- **Timeout:** one per request (`AI_TIMEOUT_MS`, default 5 minutes because CPU inference is slow).
  It covers reading the body too. A caller's own cancellation is passed through, not reported as a
  provider failure.
- **Prompts:**
  - Versioned `PromptTemplate`s in code, each with id, version, system text, renderer, output
    schema and limits. Results carry `id@version`.
  - Untrusted document text enters prompts only through `untrustedText`, which delimits it and
    neutralizes attempts to close the block early.

## Alternatives

- **Vendor SDKs or a multi-provider library (for example the Vercel AI SDK):** more features
  (streaming, tools), but more dependency surface for two HTTP calls, and less visible error
  handling.
- **The OpenAI-compatible endpoints both providers offer:** one client for both, but provider
  details (Ollama's context size, Cloudflare's "JSON Mode couldn't be met") would hide behind a
  generic client.
- **Prompt-only JSON:** fails much more often than constrained decoding.
- **Retries inside providers:** would stack with the job runner's retries and hide failures from
  the job history.

## Trade-offs

- **Two model families.** Development (Qwen 2.5 3B) and the demo (Llama 3.3 70B) answer
  differently. Quality measured locally is a lower bound, and tests never assert on model wording.
- **Document text leaves the system with the Cloudflare provider.** The README already restricts
  the demo to synthetic documents.
- **Free-tier volume.** 10,000 Neurons/day is roughly 55 calls of ~3,000 input and ~500 output
  tokens with the 70B model, so about 25 documents a day at two calls each.
- **CPU-only Ollama is slow.** A 4,600-token prompt took 130 s on the development machine.

## Consequences

- Phase 8 writes templates and schemas, then calls `generateStructured`. It never sees HTTP.
- Phase 9 maps `retryable` and `retryAfterMs` to job retries and backoff.
- A new provider is one class and one config branch.
