# SyncLab web

Dashboard for SyncLab migration jobs: status counts that double as filters, live pipeline progress, per-job execution logs, the repositories the GitHub App is installed on, GitHub sign-in, and a form to start a migration by hand.

Built with Next.js (App Router), Tailwind CSS v4, shadcn/ui, Magic UI (`number-ticker`, `border-beam`), and Aceternity UI (`sidebar`).

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:3001.
The dashboard uses port 3001 because the API in `server/api` listens on 3000.

## Pages

| Route | Shows |
| --- | --- |
| `/` | Job counts per status, the jobs a worker is running now, and a searchable, filterable job table |
| `/jobs/[id]` | One job's pipeline track, failure reason, branch name, and execution log with exit codes |
| `/repositories` | Installed repositories with job totals and last activity |
| `/migrations/new` | Pick a repository, a dependency from its root `package.json`, and a stable npm version, then start the job and open its page |
| `/settings` | Sign in with GitHub, and the App installations you can access, or an Install SyncLab button when there are none |

Filters live in the URL (`?status=FAILED`, `?repo=owner/name`, `?q=zod`), so every view can be linked.

## Configuration

Copy `.env.example` to `.env.local`.
Every variable is optional: without them the dashboard runs on sample data, and Settings lists what is missing.

| Variable | Enables |
| --- | --- |
| `SYNCLAB_API_URL` | Where the gateway in `server/api` listens. Defaults to `http://localhost:3000`. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub sign-in through the SyncLab GitHub App. Set the App's callback URL to `http://localhost:3001/auth/github/callback`. |
| `GITHUB_APP_SLUG` | The Install SyncLab link, `https://github.com/apps/<slug>/installations/new`. |
| `SESSION_SECRET` | Encrypting the session cookie (`openssl rand -base64 32`). |

## Sign-in

Signing in runs the GitHub App's web flow and keeps the user access token in an encrypted, httpOnly cookie until the token expires (eight hours by default).
With that token the server calls `GET /user/installations` and `GET /user/installations/{id}/repositories`, so a user only ever sees installations and repositories that both they and the App can reach.
Every call to the API sends the same token, and the API resolves it to the user and limits every answer to their repositories, so the dashboard holds no API secret and does no access checks of its own.

## Data

Signed in, every getter in `lib/data.ts` reads the API: `GET /migrations`, `GET /migrations/counts`, `GET /migrations/:id` and `GET /repositories`.
Signed out, they serve the built-in sample data instead, shaped exactly like the API's answers, and the pages say so with a sign-in prompt.
The samples' job pages stay public; a real job is only readable by a signed-in user whose installations reach its repository, and anyone else gets a 404.
When the API is down or no longer accepts the session, `app/error.tsx` offers a retry and a way back to Settings.

The pipeline track in `lib/pipeline.ts` reads a job's `execution_logs` the way the worker writes them: a phase's rows are flushed when the phase finishes, and each retry starts a new attempt.

## Design

- Light and dark themes follow the system setting and can be switched from the sidebar.
  Tokens live in `app/globals.css`.
- The mascot (`lib/mascot.ts`) is the single source for both the sidebar logo and `app/icon.svg`.
  After changing it, regenerate the favicon:

```bash
node -e 'import("./lib/mascot.ts").then(({ mascotSvg }) => require("fs").writeFileSync("app/icon.svg", mascotSvg() + "\n"))'
```
