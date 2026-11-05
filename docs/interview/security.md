# Security questions

[Back to interview preparation](README.md) · Full detail:
[security review](../security/security-review.md), [authentication](../security/authentication.md)

## How are documents protected?

**Say:** At each stage:

- **Upload:** the API checks the file's actual bytes (magic numbers), not the extension or the
  browser's declared type, with a 10 MiB limit, one file per request, after authentication. The
  stored key is built only from generated ids, never from the filename.
- **At rest:** a private R2 bucket with no public access and no public URL. Only the server holds
  the credentials, scoped to that one bucket.
- **Access:** files are never linked directly. They stream through the API, which checks ownership
  in SQL and writes an audit entry before the first byte. The browser shows them from a `blob:` URL
  typed with the MIME type detected at upload, with `nosniff`.
- **Processing:** text goes only to the configured AI provider. Nothing about a document's content
  goes into logs or audit entries: they hold ids, codes, sizes and field names.
- **Deletion:** one document, or "Delete all my data", which erases the user's documents, text,
  extractions, reviews, jobs and files.

**Follow-ups:**

- _Is it encrypted?_ In transit: https to every service, and verified TLS to the database
  (`sslmode=verify-full`), all required in production by config validation. At rest, by the
  providers' own disk encryption (R2, Supabase). There's no application-level or per-user key;
  that would be an enterprise requirement.
- _Did you ever get that wrong?_ Yes, and it's a good story. Preparing these answers, I checked "is
  the database connection encrypted?" and it wasn't: node-postgres uses TLS only when asked, and
  Supabase accepts plain connections by default. Nothing was deployed yet. The fix: production
  refuses to start without `sslmode=verify-full`, Supabase's CA is supplied as a secret file, and
  CI proves the connection is encrypted and that a certificate from another CA is refused (security
  review, finding 7).
- _Malware?_ Files are never executed or rendered in the app's origin, but they aren't scanned
  either. A virus scan at upload would be needed before files are shared between people.

## How is authorization enforced?

**Say:** Two layers. A global guard requires a valid token on every route; a route is public only if
it's marked `@Public()`, and only the two health checks are, so a forgotten decorator fails closed.
Then ownership: every repository method that reads or changes user data takes the owner id and
filters on it in SQL (`WHERE id = $1 AND user_id = $2`). Controllers never load a row and check the
owner afterwards, which is where those bugs usually come from. Background code has separate
`…ForProcessing` methods, which controllers never call.

**Evidence:** `apps/api/src/auth/auth.guard.ts`; the `…ForOwner` methods in the repositories;
tests across two users for documents, review, audit, analytics and erasure.

**Follow-ups:**

- _How is the token verified?_ Locally, with Supabase's public keys (JWKS, cached): asymmetric
  algorithms only (ES256/RS256), issuer, audience, expiry, role, not anonymous, and a size limit.
  No network call to Supabase per request.
- _Roles or teams?_ None: each user owns their documents. Organizations with roles would be the
  first product change for business use.

## How do you prevent IDOR?

**Say:** IDOR is someone changing an id in a URL to reach another user's object. Three things stop
it here. The owner filter is in the query itself, so another user's document simply isn't found.
The response for "not yours" is the same `404` as for "doesn't exist", so ids can't be probed.
And ids are random UUIDs, validated as UUIDs, so they can't be guessed or enumerated. Cursors are
opaque and only move within the caller's own rows. There are tests where user B requests every one
of user A's resources and gets 404s.

**Follow-ups:**

- _What about the jobs table, which is reached through documents?_ It has its own `user_id`, kept
  equal to the document's owner by a composite foreign key, so a user's jobs are filtered directly.
- _Why not 403?_ A 403 confirms the object exists.

## How are storage credentials protected?

**Say:** They exist only as environment variables on the server: in production, in Render's
dashboard, never in the repository or in GitHub. Config validation at startup checks they're
present and never echoes values in its error messages. The logger redacts secret-looking keys. The
browser never talks to storage and never gets a presigned URL, so nothing in the web bundle or
network traffic carries a credential. The token itself is scoped to object read and write on one
bucket. The web app's `VITE_*` variables are public by design, and the built bundle was checked
for server secrets during the security review.

**Follow-ups:**

- _What's in GitHub?_ One secret: a Cloudflare token that can only deploy the Pages site. The
  production database, storage and AI credentials are not there.
- _Rotation?_ Create the new key, update the host, redeploy, revoke the old one. It's in the
  runbook.

## What happens to uploaded documents?

**Say:** Validated, stored privately, read by the worker for text extraction, and the text (up to
8,000 characters) is sent to the AI provider. The text and the extraction are stored in the
database; the file stays in storage. They stay until the user deletes the document or all their
data. There's no automatic expiry yet; a retention period is a product decision I'd make before
real use.

**Follow-ups:**

- _Who else sees them?_ The AI provider sees the text. Locally that's Ollama on the same machine;
  in the demo it's Cloudflare Workers AI. That's why the demo says to use synthetic documents only.
- _What survives deletion?_ The audit entries, which hold no content, and the Supabase sign-in
  account, which has to be deleted in Supabase by hand.

## Why should a company trust this system?

**Say:** Honestly: not with real documents yet, and the project says so. What it offers is
evidence rather than claims. The security controls are written down with where each lives in the
code, there's a threat-by-threat security review with findings and fixes, ownership is tested
across users, every action is audited, and CI checks dependencies and the production image on
every change. The gaps are listed too. That's the starting point for trust: a system whose
behaviour you can check, with known limits.

**Follow-ups:**

- _What was the most serious finding?_ A PDF's text layer can contain text that's never drawn on
  the page. A crafted PDF could have reached automatic completion with values no reader sees. The
  fix renders those pages and requires OCR to find the same evidence, or the document goes to
  review.

## What would be required before enterprise production use?

**Say:** Roughly in priority order:

1. **Identity:** SSO (SAML/OIDC), enforced MFA, organizations with roles, and token revocation.
2. **Data protection:** encryption keys per tenant (a KMS), a data-processing agreement with the AI
   provider (no retention, no training) or a self-hosted model, data residency, retention
   policies, and malware scanning of uploads.
3. **Reliability:** backups with point-in-time recovery and tested restores, more than one
   instance, a shared rate-limit store, a lease heartbeat, and load tests at the target volume.
4. **Operations:** central logs with retention, metrics and alerting, on-call, and runbooks for
   incidents.
5. **Assurance:** an independent penetration test, a threat model review, and the controls an
   audit like SOC 2 would ask for. None of those exist today, and I'd never claim them.
6. **Accuracy:** a labelled evaluation set, so the error rate of auto-completed documents is
   measured, not assumed.
