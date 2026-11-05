# Interview preparation

How to present DocuMind in an interview, and answers to the questions it invites. Every answer
points at the code, an ADR or a measurement, so it can be backed up on the spot.

| Topic                                         | Questions                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| [Architecture](architecture.md)               | Monolith, PostgreSQL, R2, async processing, queue, worker, AI abstraction     |
| [Database](database.md)                       | Tables, indexes, frequent queries, transactions, idempotency                  |
| [Distributed systems](distributed-systems.md) | Worker crashes, duplicates, retries, scaling workers, AI outages              |
| [AI](ai.md)                                   | OCR, why not send the PDF, structured output, validation, hallucinations      |
| [Security](security.md)                       | Document protection, authorization, IDOR, credentials, trust, enterprise gaps |
| [Scalability](scalability.md)                 | 100× volume, bottlenecks, scaling workers and PostgreSQL, caching             |

Each answer has three parts:

- **Say:** the spoken answer, short enough to give in under a minute.
- **Evidence:** where to point if asked to show it.
- **Follow-ups:** the next question an interviewer is likely to ask, with a short answer.

## The 60-second pitch

> DocuMind turns uploaded invoices, purchase orders and contracts into structured, reviewed data.
> The upload request only validates and stores the file and queues a job, in one database
> transaction. A worker then reads the text, from the PDF's text layer or with OCR, has an LLM
> classify the document and extract its fields with a supporting quote for each, and scores every
> field by checking that quote against the document. Confident results complete on their own;
> the rest go to a person who confirms or corrects each flagged field.
>
> It's a modular monolith in NestJS and React, with PostgreSQL as both the database and the job
> queue, files in private object storage, and the AI provider behind an interface: Ollama locally,
> Cloudflare Workers AI in the demo. It runs at zero cost on free tiers, has about a thousand
> automated tests, a security review, and a performance review at a million documents.

What to emphasise, depending on the role:

- **Backend:** the PostgreSQL queue (`SKIP LOCKED`, leases, fencing), the transactional enqueue,
  and the idempotency of every step.
- **AI/ML engineering:** evidence-based confidence instead of the model's self-report, schema-
  constrained output, and prompt-injection handling.
- **Full stack:** the shared Zod contracts used by both sides, keyset pagination, and the review UI.
- **Platform/SRE:** request ids end to end, CI that smoke-tests the production image, and the
  measured capacity limits.

## A five-minute demo

1. **Upload** an invoice and a scanned purchase order on the Documents page. Point out the per-file
   progress and that the API checked the bytes, not the extension.
2. **Processing** page: the jobs queue and run. Open the response headers to show `X-Request-Id`,
   then find the same id in the job's row and the worker's log lines.
3. **Document detail:** the extracted fields, each with its quote and confidence. Show a field
   flagged because its quote does not contain the value, and correct it.
4. **Approve** it, then show the document's activity timeline: every step audited, with no document
   content in the entries.
5. **Analytics:** review rate and correction rate. "The correction rate is what review caught;
   auto-completed documents nobody checked."
6. **Close** with an architecture trade-off you would revisit (below).

Have ready: your own account with a few documents already processed (the seed's demo user can't
sign in without a matching Supabase user), `npm run ai:up` already pulled (local processing takes
about a minute per document), and a document with a planted error (a total that does not add up)
to show a business-rule flag.

## Numbers worth knowing

| Fact                                      | Value                                                    | Source                                                                                 |
| ----------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Automated tests                           | 1,012 (shared 45, API 679, web 288)                      | `npm run check`                                                                        |
| Document list at 1M documents             | 4–5 ms p50                                               | [performance review](../operations/performance-review.md)                              |
| Processing summary, before and after fix  | 534 ms → 31 ms (largest account)                         | [performance review](../operations/performance-review.md)                              |
| Queue throughput                          | 218, 658, 1,625 jobs/s with 1, 4, 16 workers             | [performance review](../operations/performance-review.md)                              |
| Needed for 100,000 documents a day        | about 1.2 jobs/s                                         | [performance review](../operations/performance-review.md#scaling-path)                 |
| One API process                           | about 400–450 requests/s on a full core                  | [performance review](../operations/performance-review.md)                              |
| OCR, one scanned page                     | about 3 s on a laptop core, about 46 s on the free host  | [deployment](../operations/deployment.md#measured-on-the-free-instances-limits)        |
| Peak memory, 20 MP photo on the free host | 336 MB of 512 MB (was over 500 MB before downscaling)    | [deployment](../operations/deployment.md#measured-on-the-free-instances-limits)        |
| Free AI allocation                        | about 27 documents a day                                 | [performance review](../operations/performance-review.md#capacity-what-runs-out-first) |
| Review threshold                          | overall confidence 0.90                                  | `packages/shared/src/review.ts`                                                        |
| Retries                                   | 3 attempts, 30 s × 2^(n−1) with jitter, capped at 15 min | [job queue](../processing/job-queue.md#failure-classification)                         |

## Trade-offs to volunteer

Interviewers trust a candidate who names the weak spots first. These are real, documented, and
each has a known fix:

- **No lease heartbeat.** A job must finish within its 15-minute lease. Simple and correct with one
  worker, but at scale a long scan on a slow CPU could be taken over and repeated. The fix is a
  heartbeat that extends the lease ([ADR-008](../adr/008-retry-and-idempotency.md)).
- **One job per worker process.** The worker idles while waiting for the AI. Per-process
  concurrency of 2–4 would use the core better.
- **Rate limits in process memory.** Correct for the demo's single instance; a second instance
  needs a shared store.
- **Confidence is heuristic.** It catches invented quotes and values not in the quote, but a real
  quote from the wrong line can pass. Business rules catch some of those. Accuracy has not been
  measured on a labelled dataset.
- **Only the first 8,000 characters** reach the model. Long contracts are flagged for review rather
  than chunked.
- **Access tokens can't be revoked early** and live in `localStorage`. A strict CSP limits the XSS
  risk.

## What I would do differently

- Start with a labelled evaluation set of synthetic documents, so prompt and model changes are
  measured against accuracy, not only checked by hand.
- Push status changes to the web app (server-sent events), instead of making users refresh.
- Decide retention up front. Files never expire today, so storage is the second free-tier limit
  to run out.
