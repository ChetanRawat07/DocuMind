# ADR-013: Supabase Auth with bearer tokens verified against JWKS

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

Phase 2 needs sign-up, sign-in, sign-out, password reset, protected API routes and per-user
ownership. Constraints:

- Zero operating cost (ADR-009); Supabase is already the planned database host.
- No password storage in DocuMind (Phase 1 decision: `users.id` is the Supabase user id).
- The web app (Cloudflare Pages) and the API (Render) are deployed on different sites.
- Local development and tests should not depend on a live Supabase project.

Supabase issues short-lived access tokens (JWT) plus refresh tokens. Projects can sign tokens with
asymmetric keys (ES256/RS256), published at `<project>/auth/v1/.well-known/jwks.json`, or with a
legacy shared secret (HS256), which Supabase discourages.

## Decision

1. **The browser talks to Supabase Auth directly** through supabase-js (sign-in, sign-up, refresh,
   reset). It calls the API with `Authorization: Bearer <access token>`.
2. **The API verifies tokens locally against the project JWKS** with `jose`, accepting only ES256
   and RS256. It holds no signing secret and makes no per-request call to Supabase.
3. **A global guard authenticates every route**; routes opt out with `@Public()`.
4. **Users are provisioned lazily** from verified claims on first request.
5. **Ownership is enforced in SQL** by the repositories (owner filter on every user-owned query).

## Alternatives

| Option                                       | Why not                                                                                                                                                                                                    |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API-managed httpOnly cookies (BFF)           | Keeps tokens out of JavaScript, but web and API are on different sites: cookies would need `SameSite=None`, which browsers increasingly block as third-party, plus CSRF protection and a refresh endpoint. |
| Also accept HS256 with the shared secret     | Puts a token-minting secret on the API server and a second verification path; Supabase recommends asymmetric keys.                                                                                         |
| Verify by calling Supabase `/auth/v1/user`   | Network round trip per request and an availability coupling on every API call.                                                                                                                             |
| Own auth (password hashing, sessions, email) | Large security surface (hashing, reset tokens, email delivery, rate limits) for no product value.                                                                                                          |
| Per-route guards                             | A forgotten guard fails open. A global guard with explicit opt-out fails closed.                                                                                                                           |

## Consequences

- Tokens are stored in `localStorage` by supabase-js and are readable by any script on the page: a
  strict CSP becomes a deployment requirement (Phase 16).
- Access tokens cannot be revoked before expiry; the token lifetime is the revocation window.
- Supabase key rotation works without restarts (unknown key ids trigger a JWKS refetch).
- A Supabase outage makes authenticated endpoints return 503 (new tokens cannot be verified once
  cached keys expire), while health probes keep working.
- Tests sign tokens with a locally generated key pair, so the real verification code runs offline.
- Details: [docs/security/authentication.md](../security/authentication.md).
