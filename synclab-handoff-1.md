# SyncLab handoff 1: Claude Code session "Local frontend server" to Cursor CLI

Written 2026-10-17 at the end of a long Claude Code session.
Read this first, then `AGENTS.md`, `CLAUDE.md` and the root `README.md`.

## 0. Ground rules from the user (AGENTS.md and CLAUDE.md)

- Never use the em dash character; use "--" or rephrase.
- Never add an agent as co-author in commits.
- Long Markdown files: one full sentence per physical line.
- Prefer quality, simplicity and long-term maintainability over development cost.
- Bug fixes start with an end-to-end reproduction.
- Be picky about UI (pixel perfection) and fix lint, test failures and flakiness even if unrelated.
- Worktrees: before creating one, ask the user which issue it is for and name it after the issue (the user has repeatedly chosen a plain name with no issue instead).
  After its PR merges, confirm it is clean and its commits are on the default branch, then remove the worktree and delete the branch locally and on the remote.
  Never remove a worktree or branch that belongs to another session.
- Commit or push only when the user asks; merge PRs only when asked.
- The user validates PRs with the `/no-mistakes` pipeline (`no-mistakes axi run --intent "..."`), then asks the agent to merge and clean up.
  Findings marked `ask-user` must be relayed verbatim and decided by the user.

## 1. What SyncLab is

A dependency-migration service.
When a dependency has a breaking release, SyncLab clones the repository, upgrades the dependency, rewrites the affected code with an LLM, runs the tests in a Docker sandbox, and opens a pull request.

- `server/api`: NestJS gateway and worker (Prisma on PostgreSQL, BullMQ on Redis). `APP_ROLE` = `all` | `gateway` | `worker`. API on port 3000.
- `server/sandbox`: the sandbox image (`synclab-sandbox:latest`, `npm run sandbox:build` in `server/api`). Phases: prepare (clone, install, upgrade, release notes), refactor and test loop, publish.
- `web`: Next.js 16 (App Router, `cacheComponents: true`), Tailwind v4, shadcn/ui (radix-nova, radius 0), Magic UI, Aceternity UI, visual reference meuze.ai. Port 3001. Read `web/node_modules/next/dist/docs/` before writing Next code: this Next version differs from training data (for example `error.tsx` receives `retry`).
- `benchmarks`: migration benchmark cases.
- `infra/Architecture/*.md`: design docs (Obsidian vault).
- Local services: Postgres 15 (Homebrew on localhost:5432, which is what `DATABASE_URL` in `server/api/.env` points at; a Docker `synclab-postgres` also exists), Redis 7 (Docker `synclab-redis`, port 6379), Ollama for the default local model (`qwen2.5-coder:14b` and `:7b` pulled).

## 2. Chronology of this session (all merged to main)

1. Ran the dashboard locally; created worktree `dashboard-polish`.
2. **PR #12 (merged)**: bigger sidebar mascot and wordmark; `/settings` with GitHub App OAuth sign-in (Tabler `IconBrandGithub`), installations list from `GET /user/installations` with an Install SyncLab button when empty; `/migrations/new` form (repository, dependency from root `package.json`, stable npm version) that calls `POST /migrations` and opens `/jobs/[id]`; API `GET /migrations/:id`.
   Session is an AES-256-GCM encrypted httpOnly cookie that expires with the GitHub user token (8 hours, no refresh token).
   `/no-mistakes` fixes: open redirect in `safeReturnTo`, job pages gated to users with access, form values survive React's post-action reset, `getJob` wrapped in React `cache()`, access compared by GitHub repo id.
3. **PR #13 (merged)**: root `.gitignore` (`node_modules/`, `.env*` except `.env.example`, `.claude/worktrees/`, `.claude/settings.local.json`, `.DS_Store`, `*.profraw`).
4. **PR #15 (merged)**, worktree `api-access-and-triggers`:
   - The API identifies callers: a bearer equal to `MIGRATIONS_API_TOKEN` is an all-access service caller; any other bearer is treated as a GitHub App user access token and resolved through GitHub (`/user`, `/user/installations`, each installation's repositories, cached 60 s per sha256(token)). Every read and write is scoped by GitHub repository id; inaccessible jobs and repositories answer 404. Code: `server/api/src/gateway/api-auth.guard.ts`, `server/api/src/github/github-user.service.ts`, `server/api/src/gateway/migration-queries.service.ts`.
   - New routes: `GET /migrations` (status, repo, q, limit up to 500), `GET /migrations/counts`, `GET /repositories`.
   - The release webhook was replaced by a `pull_request` trigger for Dependabot and Renovate npm updates (`server/api/src/gateway/dependency-update.ts`). It ignores other authors, forks, other ecosystems, grouped updates and subdirectories; Renovate PRs need the `renovatebot.com/diffs/npm/<pkg>` link; both bots need the dependency declared in the root `package.json` (read with the installation token). GitHub 403 rate limits answer 503, not 401.
   - The dashboard sends the signed-in user's own GitHub token to the API and no longer uses `MIGRATIONS_API_TOKEN`. Signed out, pages show sample data with a "Sample data" sign-in notice (an explicit user decision).
5. **PR #20 (merged)**, worktree `github-app-smoke-test`: `npm run github-app:register` in `server/api` (`server/api/scripts/register-github-app.mjs`) registers the GitHub App through the App Manifest flow and writes its credentials into `server/api/.env` and `web/.env.local` (mode 600, never printed). Only `--webhook-url` and `--name` flags (user decision). `*.pem` is gitignored in `server/api`.
6. All four worktrees from this session were removed and their branches deleted locally and on the remote after merge.

Other sessions merged a lot in parallel: #16, #17, #18, #19, #21 to #31 (sandbox security and baseline tests and yarn/pnpm, Anthropic provider, live job page, retry failed jobs, Playwright e2e, API usage scanner and registry, provider change monitor, landing page at `/` with the dashboard moved to `/dashboard`).
Read `git log origin/main` before touching any of those areas.

## 3. Real GitHub smoke test (done 2026-10-16)

- GitHub App **`synclab-kiet08hogit`** (id 5340865, private): https://github.com/apps/synclab-kiet08hogit.
  Permissions: Contents and Pull requests read and write, Metadata read. Event: Pull request. Sign-in callback `http://localhost:3001/auth/github/callback`.
  Webhook URL: public smee.io channel `https://smee.io/ZKzwiJdxxU54uIgl` (anyone with the URL can read deliveries; acceptable only for testing).
- Installed only on the private repo **`kiet08hogit/synclab-smoke-test`**: a tiny zod 3.23.8 project whose `src/signup.js` maps over `result.error.errors` (removed in zod 4, now `.issues`); `node --test` passes on zod 3 and fails on zod 4 with `TypeError: Cannot read properties of undefined (reading 'map')`. Dependabot is configured; **its PR #1 "Bump zod from 3.23.8 to 4.6.7" is still open**.
- Credentials (private key, client id and secret, webhook secret, session secret) exist **only** in `~/.config/synclab/synclab-kiet08hogit/` (mode 700 and 600, with a README.txt). Never commit or print them.
- Results:

| Step | Result |
| --- | --- |
| Manifest registration | Worked |
| Real Dependabot `pull_request` webhook through smee | Signature verified, job created |
| Worker on the private repo with an installation token | Clone, install, upgrade, test ran |
| Real GitHub sign-in and dashboard | Worked; installation and real job shown |
| Migration quality | **Failed** (see section 6) |
| Publishing a real PR | Not reached |

- To rerun: copy the `GITHUB_*` values from that folder into `server/api/.env` and `web/.env.local`, put the `.pem` next to `server/api/.env` with `GITHUB_PRIVATE_KEY_PATH="./synclab-kiet08hogit.private-key.pem"`, run `npx smee-client --url https://smee.io/ZKzwiJdxxU54uIgl --target http://localhost:3000/webhook`, start the API (`npm run start` in `server/api`, role `all` to include a worker) and the dashboard, then close and reopen Dependabot's PR #1 on the smoke repo to fire a webhook.
  Use a separate Redis (the smoke run used a throwaway `redis:7` container on port 6380) and database so other sessions' workers do not take the job.

## 4. Important architectural decisions

- Access control lives in the API, keyed by GitHub repository id (stable across renames), resolved from the caller's own GitHub App user token. `MIGRATIONS_API_TOKEN` remains only as a service credential for scripts.
- The automatic trigger is Dependabot or Renovate pull requests, not npm polling; SyncLab opens its own PR on `synclab/<dep>-<version>` next to the bot's.
- Signed-out dashboard visitors see clearly labelled sample data; sample job ids stay public; real jobs need sign-in and access.
- Web session: encrypted cookie, no server-side store, OAuth `state` sealed in a short-lived cookie scoped to `/auth/github`, `returnTo` restricted to same-origin paths.
- GitHub App registration goes through the manifest script so secrets are never copied by hand.

## 5. Current state (2026-10-17)

- `main` head: `29eadc1` (Merge PR #31). The dashboard is now at `/dashboard`; `/` is a landing page.
- Main checkout: branch `develop`, which differs from `origin/main` (14 commits only on main, 10 only on develop). It carries the user's own uncommitted, unrelated edits (`.cursor/*`, `CURSOR.md`, `infra/.obsidian/workspace.json`, `synclab_benchmark_results.txt`, `benchmarks/results/workspaces/`). Do not commit or discard those.
- Open PR from another session: **#32** `phase-6b-api-change-monitoring` (OpenAI spec diff, LLM change classifier, confirm and dismiss endpoints), worktree `.claude/worktrees/phase-6-api-change-monitoring`.
- Other worktrees: `.claude/worktrees/luminous-fluttering-sedgewick` (`feat/manual-trigger-endpoint`, PR #5 long merged, idle; not this session's, so ask before removing). Local branch `worktree-agents-md-worktree-cleanup-rule` exists (not this session's).
- Other Claude sessions were still running: synclab-9d, synclab-af, synclab-da, and "Ollama local LLM replacing Gemini API". Check before editing the same files.
- Leftovers from this session's smoke test: database `synclab_smoke` on the Homebrew Postgres (one failed zod job); the GitHub App and smoke repo above. The user has not asked to delete them.

## 6. Errors, blockers and unresolved issues

1. **Migration quality (blocks a real end-to-end PR)**:
   - `server/sandbox/src/changelog.ts` `fetchReleaseNotes` reads only the GitHub release for the target tag. zod's `v4.6.7` release is one commit line (62 characters) and zod has **no** `v4.0.0` GitHub release; its breaking changes are in `packages/docs/content/v4/changelog.mdx` (about 29 KB). Range-fetching releases would not fix zod; release notes need other sources (repository `CHANGELOG.md`, docs changelogs, migration guides).
   - On all three attempts `qwen2.5-coder:14b` answered "left alone, already compatible" even though the retry prompt contained the failing test output.
   - Handed to the "Ollama local LLM" session, which passed both to the user as a follow-up. That session said changelog work should start after PR #17 merged (it has now merged).
2. Sign-in has no refresh token, so users sign in again after 8 hours.
3. `GET /migrations` has no paging beyond 500 jobs.
4. Monorepo subdirectories are ignored by the trigger and worker (root `package.json` only).
5. Lesson learned: `localhost:5432` is the Homebrew Postgres, and `prisma migrate deploy` creates a missing database. Clean up test databases on that server, not in the Docker container.

## 7. Suggested next steps

1. Ask the user what to work on; candidates from this session:
   - Better release-note sources and a stronger refactor prompt or model, then rerun the zod smoke test until SyncLab opens a real PR on `synclab-smoke-test` (coordinate with the Ollama session).
   - GitHub sign-in refresh tokens.
   - `GET /migrations` paging plus dashboard paging.
   - Commenting on or linking the bot's PR from SyncLab's PR.
2. Before starting, run `git fetch`, read `git log origin/main`, `gh pr list`, and `git worktree list`, and ask which issue or name to use for the new worktree.
3. If the user wants the smoke leftovers gone: drop `synclab_smoke` on the Homebrew Postgres, close Dependabot PR #1, uninstall or delete the App, delete the smoke repo, and remove `~/.config/synclab/synclab-kiet08hogit/` (each only on explicit request).
