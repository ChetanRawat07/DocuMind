# Deployment

How DocuMind is built, tested and deployed to free tiers, and how to run it once it is live. The
decisions are in [ADR-009](../adr/009-zero-cost-deployment.md) (hosts) and
[ADR-021](../adr/021-deployment-pipeline.md) (pipeline).

The demo deployment is for synthetic documents only. Document text is sent to Cloudflare Workers AI,
and the free tiers give no availability guarantee.

```text
                       push / pull request
                               │
                     GitHub Actions (ci.yml)
        ┌──────────────────────┼─────────────────────────┐
     check                   image                   deploy-web (main only,
 lint, types, tests,   docker build, start with      after check and image)
 migrations, codegen,  production settings, health,       │ wrangler pages deploy
 coverage, build,      JIT, CORS, clean SIGTERM            ▼
 npm audit                                         Cloudflare Pages (static web app)
        │ all checks green on main                         │ browser: Bearer token, CORS
        ▼                                                  ▼
 Render (autoDeployTrigger: checksPass) ──► Docker image: migrate latest, then API + worker
                                               │            │              │
                                       Supabase Postgres   R2 bucket   Workers AI
                                       (session pooler)   (private)
```

| Part     | Host                            | Deployed by                                                               |
| -------- | ------------------------------- | ------------------------------------------------------------------------- |
| Web app  | Cloudflare Pages                | `deploy-web` job in [ci.yml](../../.github/workflows/ci.yml)              |
| API      | Render free web service, Docker | Render, from [render.yaml](../../render.yaml), once CI passes             |
| Worker   | Inside the API process          | `WORKER_IN_PROCESS=true`: the free plan has no background workers         |
| Database | Supabase Postgres               | Migrations run when the container starts ([Dockerfile](../../Dockerfile)) |
| Files    | Cloudflare R2                   | Created once by hand                                                      |
| AI       | Cloudflare Workers AI           | Created once by hand                                                      |
| Sign-in  | Supabase Auth                   | Created once by hand                                                      |

## One-time setup

Do these in order: later steps need values from earlier ones. Nothing here is committed. Secrets go
into the Render dashboard or GitHub secrets only.

### 1. Supabase (database and sign-in)

1. Create a free project. Pick the region closest to your users, and pick the Render region
   (`region` in render.yaml) to match it: the two cannot be changed later.
2. Follow [Supabase project setup](../security/authentication.md#supabase-project-setup-manual-once)
   (asymmetric JWT signing key, Confirm email on).
3. **Connection string:** Connect → **Session pooler** (port 5432). This is `DATABASE_URL`, with the
   database password filled in.
   - Not the direct connection: on the free plan it is IPv6-only, and Render connects over IPv4.
   - Not the transaction pooler (port 6543): the migrations and the queue work through it, but
     `statement_timeout` and the other session settings would not reliably apply.
4. **Email:** the built-in mailer sends only to members of your Supabase team, two messages an
   hour. A public demo needs either custom SMTP (Authentication → Emails → SMTP; several providers
   have free tiers), or accounts you create by hand (Authentication → Users → Add user).

### 2. Cloudflare R2 (document files)

1. Create a bucket, for example `documind-documents`. Leave public access and the `r2.dev` URL off.
   The API serves every file itself, after its ownership check (ADR-016).
2. Create an R2 API token with **Object Read & Write** on that one bucket only.
3. Note: `S3_ENDPOINT` = `https://<account-id>.r2.cloudflarestorage.com`, `S3_BUCKET`,
   `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. The bucket needs no CORS rules: browsers never talk
   to it.

### 3. Cloudflare Workers AI

Create an API token with only **Workers AI: Read**. Note `CLOUDFLARE_ACCOUNT_ID` (32 hex
characters) and `CLOUDFLARE_AI_API_TOKEN`.

### 4. Render (API)

1. New → Blueprint, connect this GitHub repository. Render reads `render.yaml`.
2. Enter every `sync: false` value from steps 1–3. For `CORS_ALLOWED_ORIGINS`, enter the Pages
   origin from step 5, for example `https://documind.pages.dev`. You can come back to it.
3. The first deploy builds the image, runs every migration, and starts the API with the worker.
   Note the service URL, `https://<service>.onrender.com`.

`autoDeployTrigger: checksPass` makes Render wait until every GitHub check on the commit has
passed. `buildFilter` skips API deploys for commits that touch only the web app or docs.

### 5. Cloudflare Pages (web app)

1. Create the project once, as a direct-upload project (no Git connection, so Cloudflare does not
   also build every push):
   `npx wrangler@4.151.3 pages project create documind --production-branch main`.
   Its origin is `https://<project>.pages.dev`.
2. Create a Cloudflare API token with only **Cloudflare Pages: Edit**.

### 6. GitHub

| Kind     | Name                            | Value                                        |
| -------- | ------------------------------- | -------------------------------------------- |
| Secret   | `CLOUDFLARE_API_TOKEN`          | The Pages:Edit token from step 5             |
| Variable | `CLOUDFLARE_ACCOUNT_ID`         | Cloudflare account id                        |
| Variable | `CLOUDFLARE_PAGES_PROJECT`      | `documind`                                   |
| Variable | `VITE_SUPABASE_URL`             | Supabase project URL                         |
| Variable | `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key (public by design)           |
| Variable | `VITE_API_URL`                  | `https://<service>.onrender.com` from step 4 |

- The three `VITE_*` values are bundled into the public web app, so they are variables, not
  secrets. The build refuses a `VITE_API_URL` that is not `https://host` with no path.
- Create an environment named `production` (Settings → Environments) and put the secret there.
  Optionally restrict it to the `main` branch.
- Protect `main`: require pull requests and the `Lint, types, tests` and
  `API image starts and migrates` checks.

### 7. Close the loop

1. Supabase → Authentication → URL Configuration: set the Site URL to the Pages origin, and allow
   `<origin>/login` and `<origin>/reset-password` as redirect URLs. Keep the localhost entries for
   development.
2. Render: make sure `CORS_ALLOWED_ORIGINS` is exactly the Pages origin.
3. Push to `main` (or re-run the workflow). `deploy-web` publishes the app.

## After every deploy: smoke test

Some checks need a real browser and accounts, so they are manual:

1. `curl https://<service>.onrender.com/api/v1/health/ready` → `{"status":"ok",…}`. The first
   request after an idle spell takes about a minute (the instance wakes up).
2. `curl -sI https://<project>.pages.dev/` shows `content-security-policy: frame-ancestors 'none'`,
   `strict-transport-security` and `x-frame-options: DENY` (from
   [`_headers`](../../apps/web/public/_headers)).
3. In the browser, with the developer tools console open:
   - Sign up (or sign in with an account created by hand) and confirm the email.
   - Upload a synthetic PDF and wait for it to complete or need review (see the limits below).
   - Open a preview, download the file, approve a review.
   - Settings → delete my data; the documents are gone.
   - The console shows no CSP violations.
4. Once, after the first deploy, check that the pooler applies the settings the API relies on.
   From `apps/api` on a trusted machine, with the session-pooler URL in `DATABASE_URL` (set it in
   the shell, not in a file you might commit):

   ```sh
   node -e "
     const { Client } = require('pg');
     const c = new Client({ connectionString: process.env.DATABASE_URL, statement_timeout: 30000 });
     c.connect()
       .then(() => c.query('SELECT current_setting(\'statement_timeout\') AS timeout, current_setting(\'jit\') AS jit'))
       .then((r) => { console.log(r.rows[0]); return c.end(); });
   "
   ```

   Expected: `{ timeout: '30s', jit: 'off' }` (the API's pool sends the timeout the same way;
   `jit` comes from the role, ADR-020).

## Running it

### Releases and migrations

- A merge to `main` is a release: CI runs, then Render deploys the API and the `deploy-web` job
  deploys the web app. Both are gated on the same checks, but they are not atomic: for a minute or
  two one side is newer than the other.
- **Migrations must be backward compatible.** The new container migrates while the old one is still
  serving, and a rollback does not undo migrations. Add columns and tables first, and remove old
  ones in a later release (expand, then contract).
- Migrations run with the normal 30 s statement timeout. A migration that rewrites a large table
  needs batching (performance review, finding 9).
- `migrate.js reset` is refused in production. `down` is for development only.

### Rollback

- **API:** Render → the service → Events → pick an earlier deploy → Rollback. It redeploys the old
  image but keeps the database as it is (see above).
- **Web app:** Cloudflare → Pages → the project → Deployments → an earlier one → Rollback.

### Logs and alerts

- Render → Logs shows the JSON log lines. Search by `requestId` (also in the `X-Request-Id`
  response header and in error messages the web app shows as "Reference"), `jobId` or `level`
  ([observability](observability.md)).
- Render keeps free-plan logs for a short time only. Nothing is exported.
- Render emails the account owner when a deploy fails. Nothing pages anyone.

### Secrets rotation

Create the new key or token first, update it in Render or GitHub, redeploy, then revoke the old one.
Rotating the Supabase database password means updating `DATABASE_URL` in Render.

### Monthly housekeeping (manual)

- **Orphaned files (ADR-010):** from a trusted machine, put the production values in a separate env
  file (never commit it), then run a dry run:
  `node --env-file=prod.env apps/api/dist/cli/sweep-storage.js` after `npm run build`. It lists the
  files no document references and deletes nothing. Delete them only after reviewing the list,
  with `--delete`.
- **Account deletion:** `DELETE /api/v1/me` removes a user's DocuMind data. When a user also wants
  their sign-in account gone, delete it in Supabase → Authentication → Users after the erasure.
  Deleting it there first leaves the DocuMind data behind.

## Free-tier limits

Checked on 2026-11-04. Free tiers change without notice; recheck before relying on them.

| Provider          | Limit that matters here                                                                                                                                  | Effect on DocuMind                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Render (free web) | Spins down after 15 min without inbound traffic; wakes in about a minute. 750 instance hours a month. No pre-deploy step, workers, cron, disks or shell. | First request after idle is slow. Queued jobs wait until the next request wakes the service. A job running when it spins down is retried later. |
| Render (instance) | 512 MB RAM, 0.1 CPU (ADR-009; Render's free page no longer states them)                                                                                  | OCR is about 25× slower than on a laptop core: see the measurements below.                                                                      |
| Supabase (free)   | 500 MB database. Paused after a week with too little activity; resumed from the dashboard.                                                               | About 100,000 documents of metadata (performance review). A demo nobody visits for a week gets paused.                                          |
| Supabase Auth     | Built-in mailer: team members only, 2 emails an hour                                                                                                     | Public sign-up needs custom SMTP or hand-made accounts.                                                                                         |
| Cloudflare R2     | 10 GB-month storage, 1M Class A and 10M Class B operations a month                                                                                       | Uploads never expire, so storage fills first (performance review).                                                                              |
| Workers AI        | 10,000 Neurons a day                                                                                                                                     | About 27 documents a day, below the 50-a-day per-user quota.                                                                                    |
| Cloudflare Pages  | 500 builds a month, 20,000 files, 25 MiB per file                                                                                                        | Far above what this app needs.                                                                                                                  |
| GitHub Actions    | Free for public repositories; 2,000 minutes a month for private ones                                                                                     | One CI run takes a few minutes.                                                                                                                 |

### Measured on the free instance's limits

The production image in a container limited to 512 MB and 0.1 CPU, with the API and the in-process
worker idle while the extraction ran (2026-11-04, a laptop CPU throttled by Docker):

| Step                                             | Time                                | Container peak memory |
| ------------------------------------------------ | ----------------------------------- | --------------------- |
| Start: all migrations on an empty DB, then ready | 49 s                                | 76 MB                 |
| 20 MP photo (downscaled before OCR)              | 83 s                                | 336 MB                |
| 1 scanned PDF page (cold OCR engine)             | 72 s                                | 297 MB                |
| 3 scanned PDF pages                              | 164 s (about 46 s a page once warm) | 323 MB                |

Each step ran in a fresh container, with a separate Node process for the extraction, so the peak
includes two Node runtimes: a slight overestimate of the single in-process worker.

## Known limitations

- **Long scans may not finish on the free host.** At about 46 s a page, a 20-page scan takes about
  16 minutes of OCR, before the AI calls. If nobody uses the app meanwhile, Render may spin the
  instance down mid-job. The job is then retried on the next wake, and fails after three attempts.
  The scan also outlasts the 15-minute lease, which is safe only because the demo runs one worker.
  Text-layer PDFs are not affected (under a second on a laptop core).
- **One instance only.** Rate limits are per process (security review), and the lease above assumes
  one worker. Scaling out needs a shared rate-limit store first.
- **Deploys are not atomic** across the web app and the API (see Releases).
- **Not yet verified against the real services:** the steps above were tested locally (image,
  migrations, health, CORS, headers, the free instance's limits) and by the CI workflow. The first
  real deploy must still run the smoke test, including the two pooler checks.
