# SyncLab web

Dashboard for SyncLab migration jobs: status counts that double as filters, live pipeline progress, per-job execution logs, and the repositories the GitHub App is installed on.

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

Filters live in the URL (`?status=FAILED`, `?repo=owner/name`, `?q=zod`), so every view can be linked.

## Data

The API in `server/api` has no read endpoints yet, so `lib/data.ts` serves sample data shaped like the Prisma models in `server/api/prisma/schema.prisma`.
To connect the real backend, rewrite the getters in `lib/data.ts`; the pages and components only depend on the types in `lib/types.ts`.

The pipeline track in `lib/pipeline.ts` reads a job's `execution_logs` the way the worker writes them: a phase's rows are flushed when the phase finishes, and each retry starts a new attempt.

## Design

- Light and dark themes follow the system setting and can be switched from the sidebar.
  Tokens live in `app/globals.css`.
- The mascot (`lib/mascot.ts`) is the single source for both the sidebar logo and `app/icon.svg`.
  After changing it, regenerate the favicon:

```bash
node -e 'import("./lib/mascot.ts").then(({ mascotSvg }) => require("fs").writeFileSync("app/icon.svg", mascotSvg() + "\n"))'
```
