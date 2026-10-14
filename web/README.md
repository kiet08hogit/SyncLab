# SyncLab web

Dashboard for SyncLab migration jobs: status counts, live pipeline progress, per-job execution logs, and the repositories the GitHub App is installed on.

Built with Next.js (App Router), Tailwind CSS, shadcn/ui, Magic UI (`number-ticker`, `border-beam`), and Aceternity UI (`sidebar`).

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Data

The API in `server/api` has no read endpoints yet, so `lib/data.ts` serves sample data shaped like the Prisma models in `server/api/prisma/schema.prisma`.
To connect the real backend, rewrite the getters in `lib/data.ts`; the pages and components only depend on the types in `lib/types.ts`.
