# DocuMind --- Interview-Ready AI Document Intelligence Platform

## 0. Purpose of This File

This document is the **master development specification and phased
execution plan** for building DocuMind.

The project is intentionally divided into phases. **Do not implement the
entire project in one go.**

This file is intended to be provided to Claude as the project-level
instruction/specification. Claude must inspect the current repository
state before making changes and implement **only the current requested
phase**.

The primary goals are:

1.  Deeply improve backend engineering and system-design understanding.
2.  Build production-quality, maintainable, scalable and secure
    software.
3.  Understand WHY architectural and implementation decisions are made.
4.  Follow industry-standard engineering practices.
5.  Produce a project strong enough to discuss in technical interviews.
6.  Build a real AI/document-processing product rather than a simple
    CRUD + LLM demo.
7.  Keep the project deployable at **₹0 / \$0 within applicable
    free-tier limits**.
8.  Use the UI concept supplied by the project owner as the visual
    foundation, while improving it into a polished production-style
    product.

------------------------------------------------------------------------

# 1. Product Overview

## Product Name

**DocuMind**

## Product Category

AI Document Intelligence Platform.

## Core Problem

Organizations receive large volumes of:

-   invoices
-   contracts
-   purchase orders
-   resumes
-   forms
-   PDFs
-   scanned documents

Manually reading, extracting and validating information from these
documents is slow and error-prone.

DocuMind provides a secure asynchronous document-processing pipeline:

``` text
Document
   ↓
Upload
   ↓
Object Storage
   ↓
Processing Job
   ↓
Queue
   ↓
Worker
   ↓
Text Extraction / OCR
   ↓
Document Classification
   ↓
AI Extraction
   ↓
Schema Validation
   ↓
Confidence Evaluation
   ↓
Persistence
   ↓
Dashboard / Review
```

------------------------------------------------------------------------

# 2. Project Positioning

This is NOT intended to be:

-   a toy CRUD application
-   a simple PDF uploader
-   an OpenAI API wrapper
-   a single giant Node.js file
-   a microservices showcase without justification
-   an application that claims enterprise compliance without actually
    having it

This IS intended to demonstrate:

-   modular backend architecture
-   asynchronous processing
-   queues and workers
-   object storage
-   OCR
-   LLM integration
-   structured AI output
-   schema validation
-   retries
-   idempotency
-   dead-letter handling
-   audit logging
-   authentication
-   authorization
-   secure file handling
-   database design
-   observability
-   testing
-   CI/CD
-   deployment
-   system-design thinking

------------------------------------------------------------------------

# 3. Zero-Cost Constraint

The project must target **₹0 / \$0 operating cost** for development and
portfolio/demo usage, subject to provider free-tier limits.

Do not introduce paid infrastructure unless explicitly approved.

## Target architecture

### Frontend

-   React
-   Vite
-   TypeScript
-   Tailwind CSS
-   Cloudflare Pages for deployment

### Backend

-   NestJS
-   TypeScript
-   REST APIs
-   Render Free or another approved zero-cost deployment option

### Database

-   PostgreSQL
-   Supabase Free

### Object Storage

-   Cloudflare R2

### Local Development AI

-   Ollama
-   Open-source local model

### Production/Demo AI

-   Cloudflare Workers AI or another explicitly approved
    zero-cost/free-tier provider

### OCR

-   Tesseract OCR

### Queue

Local development:

-   RabbitMQ via Docker

Production/demo:

-   Prefer a zero-cost cloud-native queue or database-backed job
    mechanism if a continuously hosted RabbitMQ instance would violate
    the zero-cost constraint.

Do NOT deploy RabbitMQ merely for architectural appearance.

### Containerization

-   Docker
-   Docker Compose

### CI/CD

-   GitHub
-   GitHub Actions within free limits

------------------------------------------------------------------------

# 4. AI Provider Abstraction

The application must not tightly couple business logic to one AI
provider.

Use an abstraction similar to:

``` text
AIProvider
   ├── OllamaProvider
   └── CloudflareAIProvider
```

The business layer should depend on an interface/contract rather than
directly on Ollama or Cloudflare APIs.

Example conceptual interface:

``` typescript
interface AIProvider {
  extract(
    text: string,
    schema: ExtractionSchema
  ): Promise<ExtractionResult>;
}
```

Development:

``` text
AI_PROVIDER=ollama
```

Production/demo:

``` text
AI_PROVIDER=cloudflare
```

The user of the deployed product must never need to install Ollama.

------------------------------------------------------------------------

# 5. Initial Document Types

Start with a deliberately small supported set.

## Invoice

Example output:

``` json
{
  "vendor": "",
  "invoiceNumber": "",
  "invoiceDate": "",
  "dueDate": "",
  "subtotal": 0,
  "tax": 0,
  "total": 0,
  "currency": ""
}
```

## Contract

Example output:

``` json
{
  "parties": [],
  "effectiveDate": "",
  "expiryDate": "",
  "paymentTerms": "",
  "terminationClause": "",
  "governingLaw": ""
}
```

## Purchase Order

Example output:

``` json
{
  "purchaseOrderNumber": "",
  "vendor": "",
  "orderDate": "",
  "items": [],
  "subtotal": 0,
  "tax": 0,
  "total": 0
}
```

Additional document types may be introduced later only after the core
pipeline is stable.

------------------------------------------------------------------------

# 6. Core Processing Pipeline

The canonical document lifecycle is:

``` text
UPLOADED
   ↓
QUEUED
   ↓
PROCESSING
   ↓
TEXT_EXTRACTION
   ↓
OCR_REQUIRED? ── YES ──> OCR_PROCESSING
   │
   NO
   ↓
TEXT_READY
   ↓
CLASSIFICATION
   ↓
AI_PROCESSING
   ↓
VALIDATING
   ↓
CONFIDENCE_EVALUATION
   ↓
COMPLETED
```

Failure path:

``` text
PROCESSING
   ↓
ERROR
   ↓
RETRY
   ↓
ERROR
   ↓
RETRY
   ↓
MAX ATTEMPTS
   ↓
DEAD_LETTER / FAILED
```

The system must maintain meaningful state transitions and prevent
invalid state changes.

------------------------------------------------------------------------

# 7. High-Level Architecture

``` text
                         ┌──────────────────────┐
                         │     React + Vite     │
                         │       Tailwind       │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │  Cloudflare Pages   │
                         └──────────┬───────────┘
                                    │ HTTPS
                                    ▼
                         ┌──────────────────────┐
                         │     NestJS API       │
                         │     Render Free      │
                         └──────┬───────┬───────┘
                                │       │
                     ┌──────────┘       └──────────────┐
                     ▼                                 ▼
              ┌──────────────┐                  ┌──────────────┐
              │  Supabase    │                  │ Cloudflare R2│
              │ PostgreSQL   │                  │   Documents  │
              └──────────────┘                  └──────┬───────┘
                                                       │
                                                       ▼
                                                ┌─────────────┐
                                                │ Queue       │
                                                └──────┬──────┘
                                                       │
                                                       ▼
                                                ┌─────────────┐
                                                │ Worker      │
                                                └──────┬──────┘
                                                       │
                            ┌──────────────────────────┼──────────────────┐
                            ▼                          ▼                  ▼
                       PDF Parser                 Tesseract              AI
                            │                          │                  │
                            └──────────────────────────┼──────────────────┘
                                                       ▼
                                                Schema Validation
                                                       │
                                                       ▼
                                                  PostgreSQL
                                                       │
                                                       ▼
                                                  Dashboard
```

------------------------------------------------------------------------

# 8. Architecture Principles

Follow these principles throughout the project:

-   correctness \> security \> maintainability \> understandability \>
    scalability \> performance \> development speed
-   modular monolith first
-   high cohesion
-   low coupling
-   SOLID where appropriate
-   separation of concerns
-   dependency inversion where useful
-   avoid speculative abstractions
-   avoid unnecessary microservices
-   avoid premature optimization
-   explicit error handling
-   strong typing
-   consistent API contracts
-   consistent database access patterns
-   security at every boundary

Do not add architecture merely because it looks impressive.

Every major architectural component must have a reason.

------------------------------------------------------------------------

# 9. Repository Structure

The exact structure may evolve after architectural review, but the
intended direction is:

``` text
documind/
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── layouts/
│   │   ├── hooks/
│   │   ├── services/
│   │   ├── types/
│   │   └── utils/
│   └── ...
│
├── backend/
│   ├── src/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── documents/
│   │   ├── processing/
│   │   ├── jobs/
│   │   ├── storage/
│   │   ├── extraction/
│   │   ├── audit/
│   │   ├── analytics/
│   │   ├── health/
│   │   └── common/
│   └── ...
│
├── worker/
│   ├── src/
│   │   ├── processors/
│   │   ├── ocr/
│   │   ├── ai/
│   │   ├── parsers/
│   │   ├── queue/
│   │   └── common/
│   └── ...
│
├── shared/
│   ├── schemas/
│   ├── types/
│   └── constants/
│
├── docs/
│   ├── architecture/
│   ├── adr/
│   ├── api/
│   ├── database/
│   └── security/
│
├── docker-compose.yml
├── README.md
└── .env.example
```

Do not create this structure blindly. Review the architecture first and
adjust where justified.

------------------------------------------------------------------------

# 10. Database Principles

PostgreSQL is the system of record for application metadata.

Actual documents belong in object storage.

Never store uploaded PDFs/images as database blobs unless there is an
explicitly documented reason.

Potential core entities:

``` text
users
documents
document_extractions
processing_jobs
audit_logs
```

Potential later entities:

``` text
document_versions
extraction_schemas
review_actions
job_attempts
system_events
```

The final schema must be designed deliberately before implementation.

Every schema change must use migrations.

No manual production schema changes.

------------------------------------------------------------------------

# 11. Storage Model

Object storage:

``` text
documents/
  {userId}/
    {year}/
      {documentId}/
        original.pdf
```

Do not use raw user-provided filenames as storage keys.

Use generated identifiers.

Document record should contain metadata such as:

``` text
id
user_id
filename
mime_type
file_size
storage_key
document_type
status
created_at
updated_at
completed_at
```

Storage must be private.

Access must be controlled.

Use signed/authorized access where appropriate.

------------------------------------------------------------------------

# 12. Security Model

This project must explicitly address:

## Authentication

-   Supabase Auth or approved authentication solution
-   secure token handling
-   expiration
-   protected routes

## Authorization

Every backend operation must verify:

1.  user is authenticated
2.  user has permission
3.  requested resource belongs to the user or is otherwise authorized

Prevent IDOR/BOLA.

## File security

Validate:

-   extension
-   MIME type
-   actual file signature where practical
-   file size
-   filename
-   storage path

Reject unexpected file types.

Prevent arbitrary file execution.

Never trust client-provided MIME type.

## Secrets

Never commit:

-   API keys
-   database passwords
-   JWT secrets
-   storage credentials
-   AI credentials

Use environment variables and platform secret management.

## Sensitive data

Never log:

-   passwords
-   access tokens
-   refresh tokens
-   API keys
-   complete sensitive documents
-   unnecessary PII

------------------------------------------------------------------------

# 13. Privacy Positioning

DocuMind is a portfolio/demo project.

The public deployment must clearly state that it should not be used for
real confidential, medical, legal, financial or highly sensitive
documents.

Use synthetic/demo documents.

The project should eventually support retention controls.

Example:

``` text
Document retention:
7 days
30 days
Manual deletion
```

Deletion must remove both:

-   database metadata
-   object-storage file

Do not claim SOC 2, ISO 27001, HIPAA, GDPR compliance, or enterprise
security certification unless those requirements are genuinely
implemented and independently verified.

------------------------------------------------------------------------

# 14. UI / UX Direction

The supplied DocuMind UI concept is the visual starting point.

The concept establishes:

-   white/light interface
-   fixed left sidebar
-   blue primary accent
-   clean cards
-   spacious dashboard
-   sticky top bar
-   document-focused navigation
-   processing/status indicators
-   analytics cards
-   recent-document table
-   responsive behavior

The concept includes navigation such as:

``` text
Workspace
- Dashboard
- Documents
- Processing
- Review

Insights
- Analytics
- Audit Logs

Settings
```

It also establishes a dashboard with:

-   Documents
-   Processed
-   Extraction accuracy
-   Needs review
-   Processing activity
-   Document types
-   Recent documents

The supplied concept uses a restrained professional SaaS visual language
rather than a flashy consumer UI.

Do not replace the concept with an unrelated visual style.

However, Claude may improve:

-   spacing
-   typography
-   empty states
-   loading states
-   accessibility
-   responsive behavior
-   interactions
-   hierarchy
-   micro-interactions
-   upload experience
-   document detail experience
-   review workflow
-   charts
-   status visualization

The UI should look like a real SaaS product, not an AI-generated
template.

------------------------------------------------------------------------

# 15. Required Screens

The project should eventually contain:

## Authentication

-   Login
-   Signup
-   Forgot password
-   Reset password

## Dashboard

-   KPI cards
-   processing activity
-   document type distribution
-   recent documents
-   processing status
-   review queue summary

## Documents

-   document list
-   search
-   filtering
-   sorting
-   pagination
-   upload
-   status
-   confidence
-   document type

## Document Details

Display:

-   filename
-   document type
-   status
-   upload date
-   processing duration
-   confidence
-   extracted fields
-   original document access
-   processing timeline
-   retry/reprocess action where authorized

## Review

Show low-confidence fields requiring human review.

Example:

``` text
Vendor              ABC Pvt Ltd       98%
Invoice Number      INV-1023          99%
Invoice Date        20/10/2026        97%
Total               ₹58,200           72%  ← Review
```

## Processing

Show:

-   queued jobs
-   active jobs
-   completed jobs
-   failed jobs
-   retry count
-   failure reason
-   processing duration

## Analytics

Show:

-   total documents
-   processing volume
-   document types
-   success/failure rate
-   average processing time
-   extraction confidence
-   review rate

## Audit Logs

Show:

-   timestamp
-   action
-   actor
-   resource
-   request/correlation ID where appropriate

## Settings

Include:

-   profile
-   retention settings
-   AI provider information
-   security/session controls

------------------------------------------------------------------------

# 16. Document Upload UX

Upload should feel like a real product.

Support:

-   drag and drop
-   file picker
-   upload progress
-   validation errors
-   file size indication
-   supported file types
-   processing status

After upload:

``` text
Upload
 ↓
Uploaded
 ↓
Queued
 ↓
Processing
 ↓
Completed
```

Do not block the browser waiting for OCR/AI processing.

------------------------------------------------------------------------

# 17. AI Extraction Design

The AI must not be trusted blindly.

Pipeline:

``` text
OCR/Text
 ↓
Document classification
 ↓
Schema selection
 ↓
Prompt construction
 ↓
AI inference
 ↓
JSON parsing
 ↓
Schema validation
 ↓
Business validation
 ↓
Confidence evaluation
 ↓
Persistence
```

Use structured schemas.

Use Zod or another strongly typed validation system.

Invalid AI output must not silently enter the database as valid
structured data.

------------------------------------------------------------------------

# 18. Confidence System

Confidence must be explainable enough for the UI.

Possible field-level representation:

``` json
{
  "total": {
    "value": 58200,
    "confidence": 0.94
  }
}
```

Overall confidence may be calculated from field-level confidence
according to a documented strategy.

Do not pretend that an LLM-generated confidence number is objective
truth.

The UI should communicate confidence as a review signal, not a
guarantee.

------------------------------------------------------------------------

# 19. Asynchronous Processing

Long-running operations must not execute inside the normal upload
request.

Use:

``` text
Upload request
    ↓
Persist document
    ↓
Create job
    ↓
Return quickly
```

Then:

``` text
Worker
 ↓
OCR
 ↓
AI
 ↓
Validation
 ↓
Persistence
```

The system must consider:

-   retries
-   exponential backoff
-   max attempts
-   duplicate messages
-   idempotency
-   dead-letter handling
-   worker crashes
-   partial failure
-   stale jobs
-   job visibility/status

------------------------------------------------------------------------

# 20. Idempotency

A document must not accidentally be processed twice because of:

-   duplicate HTTP requests
-   duplicate queue messages
-   worker retry
-   network timeout
-   worker crash

Define idempotency strategy before implementation.

Possible mechanisms:

-   unique processing job key
-   document processing version
-   job state checks
-   database uniqueness constraints

Do not rely solely on application-level checks when a database
constraint can enforce the invariant.

------------------------------------------------------------------------

# 21. Retry Strategy

Retries must be deliberate.

Example:

``` text
Attempt 1
   ↓ failure
Wait
   ↓
Attempt 2
   ↓ failure
Wait
   ↓
Attempt 3
   ↓ failure
FAILED / DLQ
```

Use exponential backoff where appropriate.

Do not retry permanent failures indefinitely.

Differentiate:

-   transient errors
-   validation errors
-   unsupported documents
-   AI failures
-   storage failures
-   malformed input

------------------------------------------------------------------------

# 22. Observability

Implement:

-   structured logs
-   request/correlation IDs
-   health endpoint
-   readiness/liveness where applicable
-   job processing metrics
-   error counts
-   processing duration
-   AI latency
-   OCR latency

Example correlation:

``` text
requestId
   ↓
API log
   ↓
job record
   ↓
worker log
   ↓
AI call log
   ↓
completion log
```

Never include secrets or unnecessary sensitive content in logs.

------------------------------------------------------------------------

# 23. Testing Strategy

Every meaningful feature must include tests.

## Unit

Test:

-   business logic
-   validators
-   extraction parsers
-   confidence calculations
-   state transitions

## Integration

Test:

-   database
-   repositories
-   storage abstraction
-   queue integration

## API/E2E

Test:

-   authentication
-   authorization
-   upload
-   document retrieval
-   processing status
-   reprocessing
-   deletion

## Failure scenarios

Test:

-   invalid file
-   oversized file
-   OCR failure
-   AI timeout
-   malformed AI JSON
-   schema validation failure
-   storage failure
-   duplicate job
-   unauthorized document access
-   expired authentication

------------------------------------------------------------------------

# 24. Git Workflow

Use:

``` text
main
  ↑
feature/*
```

Each feature should be small and logically isolated.

Commit messages should be meaningful.

Examples:

``` text
feat: add document upload endpoint
feat: add invoice extraction schema
fix: prevent duplicate processing jobs
test: cover document ownership authorization
refactor: isolate AI provider abstraction
docs: add ADR for asynchronous processing
```

Do not mix unrelated changes in one commit.

------------------------------------------------------------------------

# 25. Architecture Decision Records

Create ADRs for important decisions.

Initial candidates:

``` text
ADR-001 Modular Monolith
ADR-002 PostgreSQL as System of Record
ADR-003 Object Storage for Documents
ADR-004 Asynchronous Document Processing
ADR-005 RabbitMQ for Local Development
ADR-006 AI Provider Abstraction
ADR-007 OCR Strategy
ADR-008 Retry and Idempotency Strategy
ADR-009 Zero-Cost Deployment Architecture
ADR-010 Document Retention Strategy
```

Each ADR should contain:

``` text
Context
Decision
Alternatives
Trade-offs
Consequences
```

------------------------------------------------------------------------

# 26. PHASED DEVELOPMENT PLAN

IMPORTANT:

**Claude must NOT implement all phases at once.**

Only implement the phase explicitly requested.

At the end of each phase:

1.  Run tests.
2.  Review the implementation.
3.  Update documentation.
4.  Report what changed.
5.  Report files changed.
6.  Report architectural decisions.
7.  Report security considerations.
8.  Report known limitations.
9.  Report what should be understood for interviews.
10. Stop.

Do not automatically continue to the next phase.

------------------------------------------------------------------------

# PHASE 0 --- PROJECT FOUNDATION & ARCHITECTURE

## Goal

Establish the project foundation before feature implementation.

## Tasks

-   inspect repository
-   confirm runtime/tool versions
-   establish monorepo or repository structure
-   initialize frontend
-   initialize backend
-   initialize worker
-   establish shared types/schemas strategy
-   establish linting
-   establish formatting
-   establish TypeScript strictness
-   establish environment configuration
-   establish Docker Compose for local infrastructure
-   establish Git conventions
-   create README
-   create architecture documentation
-   create initial ADRs

## Deliverables

-   working frontend
-   working backend
-   working worker skeleton
-   Docker Compose
-   `.env.example`
-   linting
-   formatting
-   test runner
-   architecture documentation

## Do NOT build yet

-   authentication
-   AI extraction
-   OCR
-   document processing
-   analytics

------------------------------------------------------------------------

# PHASE 1 --- DATABASE & DATA MODEL

## Goal

Design the data model before implementing document workflows.

## Tasks

Design and implement migrations for:

-   users/profile representation as required
-   documents
-   document_extractions
-   processing_jobs
-   audit_logs

Define:

-   PKs
-   FKs
-   constraints
-   indexes
-   unique constraints
-   status enums
-   timestamps
-   deletion strategy

## Required analysis

For every important table:

-   why it exists
-   relationships
-   expected query patterns
-   indexes
-   concurrency concerns
-   retention implications

## Deliverables

-   ERD/documentation
-   migrations
-   seed strategy
-   repository/data-access layer
-   database tests

------------------------------------------------------------------------

# PHASE 2 --- AUTHENTICATION & AUTHORIZATION

## Goal

Build secure identity and ownership boundaries.

## Tasks

-   signup
-   login
-   logout/session handling
-   protected API routes
-   user identity
-   document ownership model
-   authorization guards
-   secure frontend route handling

## Security testing

Verify:

-   unauthenticated request rejected
-   authenticated user can access own resources
-   authenticated user cannot access another user's document
-   invalid token rejected
-   expired session handled
-   direct object access protected

------------------------------------------------------------------------

# PHASE 3 --- UI FOUNDATION

## Goal

Implement the DocuMind SaaS interface based on the supplied UI concept.

## Requirements

Implement:

-   sidebar
-   top bar
-   responsive layout
-   dashboard shell
-   cards
-   typography
-   status components
-   empty states
-   loading states
-   error states
-   accessible interactive controls

Preserve the supplied visual direction:

-   light
-   professional
-   minimal
-   blue primary accent
-   clean cards
-   document-centric
-   enterprise SaaS feel

Do not copy the concept blindly. Improve it into reusable React
components.

------------------------------------------------------------------------

# PHASE 4 --- DOCUMENT UPLOAD & OBJECT STORAGE

## Goal

Implement secure document upload.

## Tasks

-   upload UI
-   file validation
-   upload API
-   R2 integration
-   generated object keys
-   document database record
-   upload progress
-   document list
-   document deletion

## Security

Validate:

-   file size
-   extension
-   MIME
-   file signature where practical
-   ownership
-   filename
-   storage path

Do not expose storage credentials to frontend.

------------------------------------------------------------------------

# PHASE 5 --- DOCUMENT MANAGEMENT

## Goal

Create a complete document workspace.

## Tasks

-   document list
-   pagination
-   search
-   filtering
-   sorting
-   document detail page
-   status badges
-   metadata
-   delete
-   authorized download/view
-   empty/loading/error states

------------------------------------------------------------------------

# PHASE 6 --- TEXT EXTRACTION & OCR

## Goal

Build the first processing capability.

## Pipeline

``` text
PDF
 ↓
Determine text layer
 ↓
Extract text
 ↓
If insufficient text
 ↓
Render pages / image processing
 ↓
Tesseract OCR
 ↓
Normalized text
```

## Tasks

-   PDF parser
-   text extraction
-   scanned document detection
-   OCR
-   OCR error handling
-   extraction metadata
-   tests with real/synthetic samples

Do not send raw PDFs to an LLM unnecessarily.

------------------------------------------------------------------------

# PHASE 7 --- AI PROVIDER ABSTRACTION

## Goal

Integrate AI without coupling business logic to a provider.

## Tasks

-   define AI provider interface
-   Ollama provider
-   Cloudflare AI provider
-   configuration-based provider selection
-   timeout handling
-   retry classification
-   AI error normalization
-   prompt/template management

## Required demonstration

``` text
Development → Ollama
Production → Cloud AI
```

No frontend changes should be required when changing provider.

------------------------------------------------------------------------

# PHASE 8 --- DOCUMENT CLASSIFICATION & STRUCTURED EXTRACTION

## Goal

Implement actual document intelligence.

## Tasks

-   classify supported document type
-   select extraction schema
-   invoice extraction
-   contract extraction
-   purchase order extraction
-   structured JSON output
-   Zod validation
-   business validation
-   field-level confidence
-   overall confidence

Invalid model output must not be silently persisted as valid extraction.

------------------------------------------------------------------------

# PHASE 9 --- ASYNCHRONOUS QUEUE & WORKERS

## Goal

Move expensive processing out of synchronous API requests.

## Tasks

-   processing job creation
-   queue producer
-   worker consumer
-   job state machine
-   job locking/ownership
-   idempotency
-   retries
-   exponential backoff
-   dead-letter handling
-   failure classification
-   job status API

## Required interview understanding

Be able to explain:

-   why queue?
-   why worker?
-   why not process inside HTTP request?
-   what if worker crashes?
-   what if message is duplicated?
-   what if AI succeeds but DB write fails?
-   what if a job is stuck?
-   how would this scale?

------------------------------------------------------------------------

# PHASE 10 --- REVIEW WORKFLOW

## Goal

Make the platform useful when AI is uncertain.

## Tasks

-   low-confidence detection
-   review queue
-   field-level review
-   edit extracted values
-   approve/reject
-   review audit trail
-   finalization

Example:

``` text
AI extraction
      ↓
Confidence
      ↓
High ─────────> Completed
      ↓
Low
      ↓
Human Review
      ↓
Approved
```

------------------------------------------------------------------------

# PHASE 11 --- AUDIT LOGGING & OBSERVABILITY

## Goal

Make system behavior traceable.

## Tasks

-   audit log generation
-   structured logs
-   correlation IDs
-   processing timeline
-   job duration
-   error tracking
-   health endpoint
-   readiness/liveness where appropriate
-   operational dashboard data

------------------------------------------------------------------------

# PHASE 12 --- ANALYTICS

## Goal

Build the analytics section shown in the UI concept.

Metrics:

-   documents processed
-   success rate
-   failure rate
-   average processing time
-   document types
-   confidence distribution
-   review rate
-   processing volume over time

Queries must be designed against actual access patterns and supported by
appropriate indexes.

Avoid expensive unbounded queries.

------------------------------------------------------------------------

# PHASE 13 --- SECURITY HARDENING

## Goal

Perform a deliberate security pass across the entire application.

Review:

-   authentication
-   authorization
-   IDOR/BOLA
-   file upload vulnerabilities
-   SQL injection
-   XSS
-   CSRF where applicable
-   SSRF
-   CORS
-   security headers
-   rate limiting
-   brute-force protection
-   secrets
-   sensitive logs
-   dependency vulnerabilities
-   error leakage
-   storage access
-   signed URLs
-   retention/deletion
-   AI data handling

Produce a security checklist/report.

------------------------------------------------------------------------

# PHASE 14 --- TESTING & QUALITY HARDENING

## Goal

Make the project interview-ready from a quality perspective.

Implement/finalize:

-   unit tests
-   integration tests
-   API tests
-   authorization tests
-   queue tests
-   worker tests
-   OCR tests
-   AI provider tests using mocks
-   failure tests
-   idempotency tests
-   concurrency tests where meaningful

Do not depend on live AI providers for deterministic unit tests.

------------------------------------------------------------------------

# PHASE 15 --- PERFORMANCE & SCALABILITY REVIEW

## Goal

Analyze the system as if traffic were increasing.

Evaluate:

-   DB indexes
-   query plans
-   pagination
-   connection pooling
-   queue throughput
-   worker concurrency
-   object storage
-   large documents
-   memory usage
-   AI latency
-   OCR bottlenecks
-   API response times

Discuss how the system could evolve from:

``` text
100 documents/day
        ↓
10,000/day
        ↓
100,000/day
```

Do not actually introduce unnecessary distributed infrastructure unless
justified.

------------------------------------------------------------------------

# PHASE 16 --- DEPLOYMENT & CI/CD

## Goal

Deploy the interview-ready application while maintaining zero-cost
constraints.

Target:

``` text
Frontend → Cloudflare Pages
Backend → Render Free
Database → Supabase
Storage → Cloudflare R2
AI → Cloudflare AI
```

Tasks:

-   production environment configuration
-   secrets
-   build pipeline
-   migrations
-   CI
-   automated tests
-   frontend deployment
-   backend deployment
-   health checks
-   deployment documentation

Explicitly document free-tier limitations.

------------------------------------------------------------------------

# PHASE 17 --- PRODUCTION-STYLE DOCUMENTATION

## Goal

Make the repository understandable to another engineer.

README must contain:

-   product overview
-   architecture diagram
-   feature list
-   tech stack
-   local setup
-   environment variables
-   database setup
-   Docker setup
-   AI setup
-   OCR setup
-   queue setup
-   deployment
-   security model
-   API documentation
-   troubleshooting
-   limitations
-   free-tier constraints

Also include:

``` text
docs/
  architecture/
  adr/
  api/
  database/
  security/
```

------------------------------------------------------------------------

# PHASE 18 --- INTERVIEW PREPARATION

## Goal

Turn the project into an interview asset.

Prepare explanations for:

### Architecture

-   Why modular monolith?
-   Why PostgreSQL?
-   Why R2?
-   Why asynchronous processing?
-   Why queue?
-   Why worker?
-   Why object storage?
-   Why AI provider abstraction?

### Database

-   Why these tables?
-   Why these indexes?
-   Which queries are frequent?
-   Where are transactions needed?
-   How is idempotency enforced?

### Distributed systems

-   What happens when worker crashes?
-   What happens when messages duplicate?
-   How are retries handled?
-   How does the system scale workers?
-   What happens if AI is unavailable?

### AI

-   Why OCR?
-   Why not send PDF directly?
-   Why structured extraction?
-   How do you validate AI output?
-   How do you handle hallucinations?
-   How is confidence calculated?
-   How can AI providers be replaced?

### Security

-   How are documents protected?
-   How is authorization enforced?
-   How do you prevent IDOR?
-   How are storage credentials protected?
-   What happens to uploaded documents?
-   Why should a company trust this system?
-   What would be required before enterprise production use?

### Scalability

-   How would you process 100x more documents?
-   What becomes the first bottleneck?
-   How would workers scale?
-   How would PostgreSQL scale?
-   Where would caching help?

------------------------------------------------------------------------

# 27. Claude Operating Rules

When Claude receives this file:

## Rule 1 --- Do not implement everything

Only implement the current requested phase.

## Rule 2 --- Inspect first

Before modifying anything:

-   inspect repository
-   inspect existing architecture
-   inspect package versions
-   inspect database state
-   inspect relevant files
-   inspect conventions

## Rule 3 --- Design before code

For every meaningful feature:

``` text
Understand
 ↓
Design
 ↓
Review risks
 ↓
Implement
 ↓
Test
 ↓
Self-review
 ↓
Document
```

## Rule 4 --- Do not rewrite unrelated code

Make the smallest clean change required.

## Rule 5 --- Do not silently make architectural assumptions

If an ambiguity materially affects:

-   architecture
-   security
-   database
-   business logic
-   data integrity

ask for clarification.

For low-impact details, choose a reasonable default and state it.

## Rule 6 --- Teach

After meaningful implementation, explain briefly:

1.  What was built.
2.  Why it was built that way.
3.  Important engineering concepts.
4.  Security considerations.
5.  Database considerations.
6.  Scalability considerations.
7.  Failure scenarios.
8.  Interview questions I should be able to answer.

## Rule 7 --- Stop after the phase

Do not automatically begin the next phase.

------------------------------------------------------------------------

# 28. Phase Completion Report

At the end of every phase, Claude must provide:

``` text
PHASE COMPLETE

1. What was implemented
2. Architecture decisions
3. Files created/modified
4. Database changes
5. API changes
6. Security considerations
7. Tests added
8. Tests executed
9. Known limitations
10. Technical concepts learned
11. Interview questions
12. Recommended next phase
```

Then stop.

------------------------------------------------------------------------

# 29. Final Quality Gate

Before considering any feature complete:

## Architecture

-   [ ] Separation of concerns
-   [ ] SOLID where appropriate
-   [ ] Low coupling
-   [ ] High cohesion
-   [ ] No unnecessary abstraction
-   [ ] No unnecessary distributed complexity

## Database

-   [ ] Correct schema
-   [ ] Correct relationships
-   [ ] Correct constraints
-   [ ] Appropriate indexes
-   [ ] Parameterized queries
-   [ ] Correct transaction boundaries
-   [ ] Migration included
-   [ ] Concurrency considered

## Security

-   [ ] Authentication
-   [ ] Authorization
-   [ ] Ownership validation
-   [ ] Input validation
-   [ ] File validation
-   [ ] No secrets committed
-   [ ] Sensitive logs avoided
-   [ ] OWASP risks considered

## Code Quality

-   [ ] Meaningful names
-   [ ] Small focused functions
-   [ ] Strong typing
-   [ ] Consistent structure
-   [ ] Centralized error handling
-   [ ] No dead code
-   [ ] No unnecessary duplication

## Testing

-   [ ] Happy path
-   [ ] Edge cases
-   [ ] Failure cases
-   [ ] Authentication cases
-   [ ] Authorization cases
-   [ ] Malicious input
-   [ ] Duplicate requests
-   [ ] Dependency failures

## Performance

-   [ ] No obvious N+1 queries
-   [ ] No unbounded queries
-   [ ] Appropriate indexes
-   [ ] Pagination
-   [ ] Background processing for long operations
-   [ ] Reasonable payload sizes

## Operations

-   [ ] Structured logging
-   [ ] Correlation IDs
-   [ ] Health checks
-   [ ] Environment configuration
-   [ ] Documentation
-   [ ] Deployment instructions

------------------------------------------------------------------------

# 30. Definition of Interview-Ready

The project is considered interview-ready only when:

-   [ ] User authentication works
-   [ ] Authorization is enforced server-side
-   [ ] Documents are securely uploaded
-   [ ] Documents are stored outside PostgreSQL
-   [ ] PDF text extraction works
-   [ ] OCR works for scanned documents
-   [ ] AI classification works
-   [ ] Structured extraction works
-   [ ] AI output is schema-validated
-   [ ] Confidence/review workflow works
-   [ ] Processing is asynchronous
-   [ ] Worker architecture works
-   [ ] Retry strategy works
-   [ ] Idempotency is addressed
-   [ ] Failed jobs are recoverable
-   [ ] Audit logs exist
-   [ ] Structured logging exists
-   [ ] Tests cover critical paths
-   [ ] Security review is completed
-   [ ] Database indexes are justified
-   [ ] Deployment works
-   [ ] CI/CD works
-   [ ] Documentation is complete
-   [ ] Architecture decisions are documented
-   [ ] System-design questions can be answered confidently

------------------------------------------------------------------------

# 31. Initial Execution Instruction

When starting the project, begin with:

**PHASE 0 --- PROJECT FOUNDATION & ARCHITECTURE**

Do NOT jump directly into document upload, AI, OCR or dashboard
functionality.

First establish the engineering foundation.

After Phase 0 is complete, stop and wait for the instruction to proceed
to Phase 1.

The project owner wants to understand the system while building it.
Optimize for:

**CORRECTNESS \> SECURITY \> MAINTAINABILITY \> UNDERSTANDABILITY \>
SCALABILITY \> PERFORMANCE \> DEVELOPMENT SPEED**

Never sacrifice these principles merely to generate code faster.
