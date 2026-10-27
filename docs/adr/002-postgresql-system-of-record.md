# ADR-002: PostgreSQL as the system of record

- **Status:** Accepted
- **Date:** 2026-10-26

## Context

DocuMind stores users, document metadata, extraction results, processing jobs and audit logs. These
are relational (documents belong to users, extractions and jobs belong to documents), need integrity
guarantees (ownership, unique job keys, valid state transitions) and need transactional updates
(for example, saving an extraction and completing its job together).

## Decision

PostgreSQL is the single system of record for all application metadata. Locally it runs in Docker
(`docker-compose.yml`, PostgreSQL 17); the demo deployment targets Supabase's free PostgreSQL.
Schema changes are made only through version-controlled migrations (tooling chosen in Phase 1).

## Alternatives

- **MongoDB or another document store.** Flexible for extraction JSON, but weaker at relational
  integrity and multi-row transactions, which the job and ownership model rely on. PostgreSQL's
  `jsonb` covers the flexible parts.
- **SQLite.** Not suitable for a hosted multi-process deployment.

## Trade-offs

- Supabase's free tier has storage, connection and inactivity limits (documented in Phase 16).
- Extraction payloads in `jsonb` need deliberate validation because the database will not enforce
  their inner shape.

## Consequences

- PostgreSQL also hosts the job queue (ADR-005), so job state and domain state can change in one
  transaction.
- Readiness checks will depend on database connectivity once the database layer exists (Phase 1).
