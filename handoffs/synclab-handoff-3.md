# SyncLab handoff 3: Claude Code session to Cursor CLI

Written 2026-10-17 by the Claude Code session that worked on the LLM provider, the benchmark fixtures, the Phase 5 to 10 plan, Phase 5, and the Phase 6 dashboard.
Other Claude Code sessions worked on SyncLab in parallel; their work is summarized where it affects this one.
Nothing in this file is a secret: credentials are referred to by location only.

## 1. What SyncLab is

SyncLab is an autonomous API migration agent.
When a dependency ships a breaking release, it clones the affected repository, upgrades the dependency, rewrites the calling code with an LLM, proves the change with the repository's own test suite, and opens a pull request.
Untrusted repository code only runs in short-lived, locked-down Docker containers; the container that runs repository code has no network and no credentials.

Repository: https://github.com/kiet08hogit/SyncLab (public).
Local checkout: `/Users/hokiet.nguyen/Documents/side projects/SyncLab`.

Packages:

- `server/api`: NestJS gateway (webhooks, REST API) and worker (BullMQ consumers that orchestrate sandbox containers), Prisma 7 on PostgreSQL, Redis for queues.
- `server/sandbox`: the sandbox image (`synclab-sandbox`), one container per phase: `prepare`, `install`, `upgrade`, `refactor`, `test`, `publish`, plus `clone` and `scan` added in Phase 5.
- `web`: Next.js 16 dashboard (Tailwind 4 through `@tailwindcss/postcss`, shadcn/ui), with a landing page at `/` and the dashboard under `/dashboard` since PR #31.
- `benchmarks`: synthetic migration cases run through the real sandbox phases.
- `infra`: an Obsidian vault with the architecture docs and Excalidraw diagrams.

## 2. Rules the user set (keep following them)

From `AGENTS.md` and `CLAUDE.md` in the repo root:

- Never use the em dash; use `--`.
- Never add an agent name as a commit co-author.
- Never hand-edit CHANGELOG or generated files.
- Long Markdown: one sentence per line.
- Bug fixes start by reproducing the bug end to end, as a user would hit it.
- Be picky about UI; fix lint, test failures and flakiness when you see them.
- Worktrees: ask which issue before creating one and name it after the issue.
  This user has repeatedly chosen "no issue, just name it after the task"; still say so when you do it.
- After a worktree's PR merges: confirm it is clean and its commits are on `main`, then remove the worktree and delete its branch locally and on the remote.
  Never remove another session's worktree, branch, or processes.
- Surgical changes, no speculative features, state assumptions, push back when warranted.

Workflow the user expects:

- Work in a worktree under `.claude/worktrees/<name>`, branched from `origin/main`, with upstream unset (`git branch --unset-upstream`) so a bare push cannot hit `main`.
- Ship through the `no-mistakes` pipeline (`no-mistakes axi run --intent "..."`), which reviews, tests, documents, lints, pushes, opens the PR, and watches CI.
  Escalate `ask-user` findings to the user verbatim; drive `auto-fix` findings with `--action fix`; read each fix diff before approving.
  The pipeline rebases onto newer `main`, so afterwards the local branch is "diverged": verify with `git range-diff` that the rebased commits are patch-identical, then `git reset --keep <pipeline head>`.
- The user merges with "merge it", then expects cleanup.
- `develop` is a long-lived branch; the user periodically says "pull main into develop and push it".
  Done with a merge commit (`git merge --no-edit origin/main`), never a rebase.

## 3. What this session did, in order

All of these are merged into `main` unless marked otherwise.

| PR | What |
| --- | --- |
| #16 | Claude (Anthropic) as a hosted LLM provider: `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, default `claude-opus-5-5`, official `@anthropic-ai/sdk` (not LangChain, whose structured output forces `tool_choice`, which Opus 5.5 rejects), streamed fenced-block replies, `fallbacks: "default"`, 529 retryable, one `LLM_API_KEY_ENV` table on the API side. Never called live: no Anthropic key on the machine. |
| #19 | Benchmark fixture fix: query-string cases rejected correct migrations (strict `deepEqual` against parse()'s null-prototype object, and an over-broad `removedPatterns` in the hard case). After the fix qwen2.5-coder:14b passed all four. |
| #24 | Planning docs for Phases 5 to 10 (self-maintaining API): `infra/Architecture/04 - Phased Rollout.md`, `05 - Self-Maintaining API.md`, `Self-Maintaining API Workflow.excalidraw`. |
| #26 | Phase 5 part 1: API usage scanner (`server/sandbox/src/analysis/api-usage.ts`, `api-operations.ts`) and the `scan` sandbox phase. Also turned on Babel decorators (NestJS files failed to parse before). |
| #27 | Phase 5 part 2: registry tables (`api_providers`, `repository_scans`, `api_usages`), `clone` sandbox phase, scan queue and `ScanProcessor`, triggers (installation, push to default branch, `POST /repositories/:githubRepoId/scan`), `GET /repositories/:githubRepoId/api-usage`, App manifest subscribes to `push`. |
| #30 | Phase 6 dashboard: `/api-changes` page against the monitor contract, with sample data. |

Other sessions merged in the same period: #25 (benchmark rebuilt with 60 cases), #28 (Tailwind through `@tailwindcss/postcss`), #29 (Phase 6a backend: deprecation-page monitor), #31 (landing page at `/`, dashboard moved to `/dashboard`).
Open: #32, Phase 6b backend (OpenAI spec diff, LLM change classifier, confirm and dismiss endpoints), owned by another session.

Abandoned or superseded during this session:

- A qwen2.5-coder:14b versus Gemini benchmark comparison was never finished: the Gemini key in `server/api/.env` was rejected (`401 ACCESS_TOKEN_TYPE_UNSUPPORTED`, key starting `AQ.`), and the user later dropped the local model entirely (see section 6).
- qwen2.5-coder:7b scored 18 of 21 before the fixture fix, all failures on query-string cases.

## 4. Architecture decisions to preserve

### Phase 5: API usage registry

- Providers in scope: Anthropic and OpenAI only; official SDKs `@anthropic-ai/sdk` and `openai`, plus raw `fetch` and `axios` calls to `api.anthropic.com` and `api.openai.com`.
  Wrappers (LangChain, Vercel AI SDK) are out of scope.
- The scanner follows clients across modules (`.js` specifiers resolve to `.ts`), through factory functions, re-exports, CommonJS, namespaces, class fields (`this.client`), optional chaining, and `withOptions`.
  Beta methods fall back to the stable operation (`beta.messages.stream` maps to `POST /v1/messages`).
  A method missing from the table is still recorded with `operation: null`.
  An HTTP call whose method or options cannot be read statically is recorded with `operation: null, dynamic: true`, never a guessed `GET`.
- Each usage carries request keys, literal `modelIds`, and `dynamic` when part of the request is only known at runtime (Phase 7 uses that for "possible" impacts).
- `clone` makes a shallow clone with the token (the token goes to the container's home, never the shared volume); `scan` runs with no token and no network.
- At most one waiting scan per repository, enforced by a nullable unique `queued_for` column (set while QUEUED, cleared on claim).
  Scans are not retried (`attempts: 1`); the next push or a manual trigger rescans.
- Only the newest completed scan keeps its usages: completing a scan deletes the usages of that repository's older completed scans in the same transaction (`createdAt < this scan`).
- Phase 5 "Done when" was verified end to end: a signed push webhook for kiet08hogit/SyncLab produced a scan with its one Anthropic call, `client.beta.messages.stream` in `server/sandbox/src/llm/refactor-chain.ts`, as `POST /v1/messages`.

### Phase 6: change monitor and its dashboard

- The contract between backend and dashboard is the "Monitoring endpoints" section of `infra/Architecture/05 - Self-Maintaining API.md`.
  `GET /api-providers` (sources with `lastCheckedAt`, `lastError`, `latestSnapshot`, and `changeCounts`), `GET /api-changes` (filters `provider`, `status`, `kind`; newest first), `POST /api-providers/poll` (`202 {"queued": true}`); 6b adds `POST /api-changes/:id/confirm` and `/dismiss`; Phase 7 adds `GET /api-changes/:id/impact`.
  An endpoint removal's `operation` is a bare path such as `/v1/edits`, because deprecation pages give no HTTP method.
- Dashboard files: `web/app/(app)/api-changes/page.tsx` and `actions.ts`, `web/components/api-monitor.tsx`, `web/components/poll-button.tsx`, `web/lib/api-changes.ts` (samples and getters), `web/lib/api-change-format.ts` (pure helpers, unit-tested), client calls in `web/lib/api.ts`, contract types restated in `web/lib/types.ts`.
- Three data sources: signed out serves samples; signed in to an API that answers 404 on the monitor routes serves samples with a "does not run the change monitor yet" notice (`MonitorUnavailableError`, thrown only for a 404); signed in to an API with the monitor serves live data.
- "Check now" queues a poll, then re-renders every 5 s through `LiveRefresh` until every source's `lastCheckedAt` is newer than the request, giving up after 2 minutes.
- Effective-date countdowns count whole UTC calendar days: red when passed or within 30 days, muted for dismissed changes.
- Confirm and dismiss buttons are not built; they wait on 6b's endpoints.

### LLM providers

- `LLM_PROVIDER` is `ollama`, `gemini` or `anthropic` in code today, with `ollama` still the default in code.
  The user has decided to remove Ollama and default to Gemini (section 6); that PR is not done.

## 5. Current state (2026-10-17)

- `main`: `29eadc1` (PR #31 merge).
- `develop`: `809842b`, pushed; it is one merge behind `main` again, since #31 merged after the last sync.
  The main checkout is on `develop` and has the user's uncommitted local files (`.cursor/...`, `CURSOR.md`, `infra/.obsidian/workspace.json`, `synclab_benchmark_results.txt`, `benchmarks/results/workspaces/`); leave them alone.
- Worktrees still present, both owned by other sessions: `.claude/worktrees/phase-6-api-change-monitoring` (branch `phase-6b-api-change-monitoring`, PR #32) and `.claude/worktrees/luminous-fluttering-sedgewick` (locked).
  This session's worktrees are all removed and their branches deleted.
- Remote-tracking refs under `no-mistakes/*` belong to the no-mistakes gate; leave them.
- Processes: nothing of this session is running.
  Still listening: Homebrew `postgresql@15` on 5432 (starts at login, possibly used by other projects) and two no-mistakes test stubs on 4999 and 3199 (left from pipeline runs, possibly another session's).
  SyncLab's own Docker containers `synclab-postgres` and `synclab-redis` are stopped, not removed (`docker start synclab-postgres synclab-redis`).
  Note: the Homebrew Postgres and the SyncLab Postgres container both use port 5432; check which one `DATABASE_URL` reaches.
- Real GitHub App `synclab-kiet08hogit` (id 5340865) exists, installed only on the private repo kiet08hogit/synclab-smoke-test.
  Its credentials are in `~/.config/synclab/synclab-kiet08hogit/` (mode 600) and nowhere else; its webhook goes through a public smee.io channel.
  If it was registered before PR #27, its Push event must be switched on in the App settings, or pushes will not trigger scans.

## 6. Next steps, in the order the user and plan imply

1. Phase 6b (PR #32, another session): when it merges, add confirm and dismiss buttons to `/api-changes` (6b endpoints return the updated change with `status: "confirmed"` or `"dismissed"`).
2. Ollama removal PR, owed after 6b merges (user decision, 2026-10-17: "remove the local llm entirely"): remove the `ollama` provider everywhere (config, the fenced-reply and context-budget path for local models, `LLM_BASE_URL`, `LLM_NUM_CTX`, container env, tests, benchmark docs, READMEs) and make `gemini` the default.
   The user's Gemini key only reaches Flash models on the free tier, so local runs need `LLM_MODEL` set to a Flash model.
   Ollama and its models are already uninstalled from the Mac.
3. Phase 7, impact analysis, only after Phase 6 is fully merged: match confirmed changes to `api_usages` on provider, operation, and the changed parameter or model ID; `confirmed` for literal matches, `possible` for dynamic values; `GET /api-changes/:id/impact`.
4. Then Phases 8 to 10 per `infra/Architecture/04 - Phased Rollout.md`.
5. Sync `develop` with `main` again when the user asks.

## 7. Errors, gotchas, and unresolved issues

- Fresh worktree setup: `npm ci` in `server/api`, `server/sandbox` and `web`; `npx prisma generate` in `server/api`; `npx next typegen` in `web` before `tsc` (`PageProps` and `LayoutProps` are generated).
- After a rebase that brings in new web dependencies, reinstall, and clear `web/.next` if the dev server still reports `Cannot find module '@tailwindcss/postcss'`; a cached failure there survives the reinstall.
- Port 3001 (the dashboard's dev port) may be held by another session's dev server; check `lsof -iTCP:3001` before starting one, and use another port rather than killing it.
- The web e2e suite (`npx playwright test` in `web`) builds and runs the real API from `server/api` against throwaway Postgres and Redis containers; it needs `server/api` dependencies and a generated Prisma client.
- Coverage gap: now that `main` runs the monitor, no e2e test exercises the "API without the monitor" fallback on `/api-changes`.
- Real monitor data is about 200 changes, many long-past retirements, and `/api-changes` lists them all; hiding passed or dismissed changes by default may be wanted.
- The Claude provider has never made a live call; one benchmark run with a real `ANTHROPIC_API_KEY` would confirm it.
- The recorded Gemini benchmark (September) is pessimistic: its 3 non-first-attempt passes were caused by the query-string fixture bug fixed in #19.
- `server/api/README.md` documents that Apps registered before PR #27 need the Push event enabled manually.

## 8. Where the persistent notes live

Claude Code memory for this project: `~/.claude/projects/-Users-hokiet-nguyen-Documents-side-projects-SyncLab/memory/` (`MEMORY.md` is the index).
Current notes there: the GitHub App, the Phase 6 worktree, and "no local LLM".
Design docs: `infra/Architecture/00` to `05` and the Excalidraw diagrams next to them.
