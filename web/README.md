# SyncLab web

Dashboard for SyncLab migration jobs: status counts that double as filters, live pipeline progress, per-job execution logs, the repositories the GitHub App is installed on, GitHub sign-in, a form to start a migration by hand, the API change monitor's sources and breaking changes, and an operations view of queue depth, sandbox latency, and token usage.

Built with Next.js (App Router), Tailwind CSS v4, shadcn/ui, Magic UI (`number-ticker`, `border-beam`), and Aceternity UI (`sidebar`).

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:3001.
The dashboard uses port 3001 because the API in `server/api` listens on 3000.

`npm test` runs the Vitest unit tests, including `lib/*.test.ts` and the operations overview.

`npm run test:e2e` runs the Playwright suite in `e2e/` in Chromium.
It needs Docker and the API's dependencies (`npm install && npm run db:generate` in `server/api`); install the browser once with `npx playwright install chromium`.
Its global setup starts throwaway PostgreSQL and Redis containers, builds and starts the real API (gateway only, so jobs stay queued) and this app, and stubs GitHub and the npm registry in `e2e/stub.ts`.
Tests sign in through the real OAuth redirect, seed jobs straight into the database, and cover the landing page, the dashboard, operations access and live metrics, the new-migration form, retry, live refresh, log folding, and pipeline label layout from 390 to 1440 pixels.

## Pages

| Route | Shows |
| --- | --- |
| `/` | The landing page: a dark office walk-in hero titled "Code breaks. You keep shipping.", illustrated steps for Detect, Locate, Refactor, Verify, and Review, connected capability drawings, and a closing engineer crossfade. The header carries the mascot and sign-in. Routing for `/` is in the [Dashboard](../README.md#dashboard) table |
| `/dashboard` | Job counts per status, the jobs a worker is running now, and a searchable, filterable job table; refreshes every 5 seconds while any job is queued or running and no filter is set |
| `/jobs/[id]` | One job's pipeline track, failure reason, branch name, how long the latest run took, and execution log with exit codes; refreshes every 5 seconds while the job is queued or running. A dependency job's track is clone, changelog, install, baseline, upgrade, refactor, test, and pull request. An API-change job is titled by the changed field, then the operation, then the kind with underscores shown as spaces. Its track omits changelog and upgrade unless the job names both the SDK package and the version the change requires. It also shows the replacement when the change has one, the deadline, and the branch the worker pushes. A failed dependency job has a **Retry migration** button when you are signed in. An API-change job does not. Output longer than 24 lines folds to its last 12, except on a failed step, and each step's output has a copy button |
| `/repositories` | Installed repositories with job totals and last activity |
| `/api-changes` | The API change monitor: each watched Anthropic and OpenAI source with its last check, and the breaking changes found, filterable by provider, status and kind; monitor admins confirm or dismiss each change |
| `/operations` | System-wide queue depth, sandbox creation, and LLM token usage for operations admins. Access and metric behavior are in [Operations](#operations) |
| `/migrations/new` | Pick a repository, a dependency from its root `package.json`, and a stable npm version, then start the job and open its page |
| `/settings` | Sign in with GitHub, and the App installations you can access, or an Install SyncLab button when there are none |

Filters live in the URL (`/dashboard?status=FAILED`, `?repo=owner/name`, `?q=zod`), so every view can be linked.

## Configuration

Copy `.env.example` to `.env.local`.
Every variable is optional: without them the migration and API-change pages run on sample data, and Settings lists what is missing.
The operations page never substitutes sample data; see [Operations](#operations).

| Variable | Enables |
| --- | --- |
| `SYNCLAB_API_URL` | Where the gateway in `server/api` listens. Defaults to `http://localhost:3000`. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub sign-in through the SyncLab GitHub App. Set the App's callback URL to `http://localhost:3001/auth/github/callback`. `npm run github-app:register` in `server/api` registers the App and writes these, `GITHUB_APP_SLUG` and `SESSION_SECRET` for you. |
| `GITHUB_APP_SLUG` | The Install SyncLab link, `https://github.com/apps/<slug>/installations/new`. |
| `SESSION_SECRET` | Encrypting the session cookie (`openssl rand -base64 32`). |
| `GITHUB_API_URL`, `GITHUB_URL` | GitHub Enterprise Server: its REST API and its web host, where users sign in. Default to GitHub.com. |
| `NPM_REGISTRY_URL` | A registry mirror for the new-migration form's version list. Defaults to `https://registry.npmjs.org`. |

## Sign-in

Signing in runs the GitHub App's web flow and keeps the user access token in an encrypted, httpOnly cookie until the token expires (eight hours by default).
With that token the server calls `GET /user/installations` and `GET /user/installations/{id}/repositories`, so a user only ever sees installations and repositories that both they and the App can reach.
Every call to the API sends the same token, and the API resolves it to the user.
Migration and repository answers are limited to that user's repositories, so those pages hold no API secret and do no access checks of their own.
Operations metrics are system-wide, and access is described in [Operations](#operations).

## Data

Signed in, every getter in `lib/data.ts` reads the API: `GET /migrations`, `GET /migrations/counts`, `GET /migrations/:id` and `GET /repositories`.
Signed out, they serve the built-in sample data instead, shaped exactly like the API's answers, and the pages say so with a sign-in prompt.
The samples' job pages stay public; a real job is only readable by a signed-in user whose installations reach its repository, and anyone else gets a 404.
When the API is down or no longer accepts the session, `app/(app)/error.tsx` offers a retry and a way back to Settings.

`/api-changes` reads the change monitor through `lib/api-changes.ts`: `GET /api-providers`, `GET /api-changes` and `POST /api-providers/poll`, with the shapes in the "Monitoring endpoints" section of `infra/Architecture/05 - Self-Maintaining API.md`.
Signed in to an API that does not run the monitor yet, those routes answer 404, so the page serves its samples too and says the API has no monitor, rather than showing an error.
Confirm and dismiss (`POST /api-changes/:id/confirm` and `/dismiss`, through `lib/api.ts`) show only on changes whose `canReview` is true, which the API sets for users listed in its `MONITOR_ADMIN_LOGINS`; a refusal says so and refreshes the page.

The pipeline track in `lib/pipeline.ts` reads a job's `execution_logs` the way the worker writes them: a phase's rows are flushed when the phase finishes, and each retry starts a new attempt.

## Design

- Light and dark themes follow the system setting and can be switched from the sidebar.
  Tokens live in `app/globals.css`.
- The landing page (`app/page.tsx`, `components/landing/`) does not follow the sidebar theme.
  Its hero is the supplied office walk-in video on a dark field, and the illustrated sections sit on light paper.
- The mascot (`lib/mascot.ts`) is the single source for the sidebar logo, the landing header, and `app/icon.svg`.
  After changing it, regenerate the favicon:

```bash
node -e 'import("./lib/mascot.ts").then(({ mascotSvg }) => require("fs").writeFileSync("app/icon.svg", mascotSvg() + "\n"))'
```

## Operations

`/operations` shows live BullMQ queue counts, mean Docker container creation latency, creation failures, and provider-reported LLM input and output tokens.
The API authorizes the signed-in user against `OPERATIONS_ADMIN_LOGINS`, configured on the API; monitor admin access alone does not grant access.
Signed-out visitors see a sign-in prompt, and users without access see an access message.
API and Redis failures show an unavailable state without substituting sample data.
The page refreshes every five seconds while visible.

Resource counters are shared in Redis across workers and gateways.
They reset when that Redis data is cleared, so configure Redis persistence for continuity.
Queue failures reflect retained BullMQ records rather than lifetime failure totals.
Queue counts do not establish worker health.
Token counts include Anthropic cached input and Gemini provider usage from refactor and classification replies, including replies rejected by later validation.
Terminated containers and provider errors without usage cannot report their consumption.
Rebuild the sandbox image when deploying this instrumentation.

The gateway exposes the same data at `GET /operations` as JSON and `GET /metrics` in Prometheus text format.
Both endpoints require an operations admin's GitHub user token or the API's `MIGRATIONS_API_TOKEN` as a bearer token.
Use a secret file for the Prometheus bearer token; keep it out of the browser and source control.
Scrape one gateway per shared Redis instance to avoid counting the shared metrics more than once in sums.

```yaml
scrape_configs:
  - job_name: synclab
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials_file: /run/secrets/synclab_metrics_token
    static_configs:
      - targets: [gateway:3000]
```

`histogram_quantile(0.95, sum by (le) (rate(synclab_sandbox_creation_seconds_bucket[5m])))` reports the 95th percentile creation latency.
`sum(rate(synclab_llm_tokens_total[5m]))` reports recorded tokens per second.
