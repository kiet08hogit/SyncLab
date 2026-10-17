# SyncLab web

Dashboard for SyncLab migration jobs: status counts that double as filters, live pipeline progress, per-job execution logs, the repositories the GitHub App is installed on, GitHub sign-in, a form to start a migration by hand, and the API change monitor's sources and breaking changes.

Built with Next.js (App Router), Tailwind CSS v4, shadcn/ui, Magic UI (`number-ticker`, `border-beam`), and Aceternity UI (`sidebar`).

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:3001.
The dashboard uses port 3001 because the API in `server/api` listens on 3000.

`npm test` runs the Vitest unit tests (`lib/*.test.ts`) for the pipeline, formatting, sign-in redirect, and landing ASCII helpers.

`npm run test:e2e` runs the Playwright suite in `e2e/` in Chromium.
It needs Docker and the API's dependencies (`npm install && npm run db:generate` in `server/api`); install the browser once with `npx playwright install chromium`.
Its global setup starts throwaway PostgreSQL and Redis containers, builds and starts the real API (gateway only, so jobs stay queued) and this app, and stubs GitHub and the npm registry in `e2e/stub.ts`.
Tests sign in through the real OAuth redirect, seed jobs straight into the database, and cover the landing page, the dashboard, the new-migration form, retry, live refresh, log folding, and pipeline label layout from 390 to 1440 pixels.

## Pages

| Route | Shows |
| --- | --- |
| `/` | The landing page: the mascot redrawn in ASCII beside a line of code that keeps getting migrated (a dependency bump, then an API change), how both kinds of break run through the pipeline, the live Running now cards, an FAQ, and sign-in. `proxy.ts` sends a signed-in user, and old dashboard links such as `/?status=FAILED`, to `/dashboard` |
| `/dashboard` | Job counts per status, the jobs a worker is running now, and a searchable, filterable job table; refreshes every 5 seconds while any job is queued or running and no filter is set |
| `/jobs/[id]` | One job's pipeline track, failure reason, branch name, how long the latest run took, and execution log with exit codes; refreshes every 5 seconds while the job is queued or running. A failed job has a **Retry migration** button when you are signed in. Output longer than 24 lines folds to its last 12, except on a failed step, and each step's output has a copy button |
| `/repositories` | Installed repositories with job totals and last activity |
| `/api-changes` | The API change monitor: each watched Anthropic and OpenAI source with its last check, and the breaking changes found, filterable by provider, status and kind |
| `/migrations/new` | Pick a repository, a dependency from its root `package.json`, and a stable npm version, then start the job and open its page |
| `/settings` | Sign in with GitHub, and the App installations you can access, or an Install SyncLab button when there are none |

Filters live in the URL (`/dashboard?status=FAILED`, `?repo=owner/name`, `?q=zod`), so every view can be linked.

## Configuration

Copy `.env.example` to `.env.local`.
Every variable is optional: without them the dashboard runs on sample data, and Settings lists what is missing.

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
Every call to the API sends the same token, and the API resolves it to the user and limits every answer to their repositories, so the dashboard holds no API secret and does no access checks of its own.

## Data

Signed in, every getter in `lib/data.ts` reads the API: `GET /migrations`, `GET /migrations/counts`, `GET /migrations/:id` and `GET /repositories`.
Signed out, they serve the built-in sample data instead, shaped exactly like the API's answers, and the pages say so with a sign-in prompt.
The samples' job pages stay public; a real job is only readable by a signed-in user whose installations reach its repository, and anyone else gets a 404.
When the API is down or no longer accepts the session, `app/(app)/error.tsx` offers a retry and a way back to Settings.

`/api-changes` reads the change monitor through `lib/api-changes.ts`: `GET /api-providers`, `GET /api-changes` and `POST /api-providers/poll`, with the shapes in the "Monitoring endpoints" section of `infra/Architecture/05 - Self-Maintaining API.md`.
Signed in to an API that does not run the monitor yet, those routes answer 404, so the page serves its samples too and says the API has no monitor, rather than showing an error.

The pipeline track in `lib/pipeline.ts` reads a job's `execution_logs` the way the worker writes them: a phase's rows are flushed when the phase finishes, and each retry starts a new attempt.

## Design

- Light and dark themes follow the system setting and can be switched from the sidebar.
  Tokens live in `app/globals.css`.
- The landing page (`app/page.tsx`, `components/landing/`) is always dark, whatever the theme.
  Its hero canvas (`components/landing/hero-field.tsx`) samples the mascot into characters with the helpers in `lib/ascii.ts`, pauses when off screen, and draws one still frame for reduced motion.
- The mascot (`lib/mascot.ts`) is the single source for the sidebar logo, the landing hero, and `app/icon.svg`.
  After changing it, regenerate the favicon:

```bash
node -e 'import("./lib/mascot.ts").then(({ mascotSvg }) => require("fs").writeFileSync("app/icon.svg", mascotSvg() + "\n"))'
```
