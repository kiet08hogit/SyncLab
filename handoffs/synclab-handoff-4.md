# SyncLab handoff 4 (Claude Code session, 2026-10-15 to 2026-10-17)

Handoff for another coding agent (Cursor CLI) to continue without starting over.
Written 2026-10-17 by the Claude Code session that built the web dashboard features (live refresh, retry, logs, e2e suite), the Tailwind fix, and the landing page.
Other sessions worked in parallel; `handoffs/synclab-handoff-3.md` covers their work (LLM provider, benchmarks, Phase 5 to 10 plan, Phase 5, Phase 6 dashboard).
Repository: `/Users/hokiet.nguyen/Documents/side projects/SyncLab`, GitHub `kiet08hogit/SyncLab` (public).
Default branch `main`.
The user also keeps a `develop` branch, synced from main by merge when asked.

## 0. Ground rules the user set (read first)

- Follow `CLAUDE.md` and `AGENTS.md` at the repo root.
  Key points: never use the em dash character, use "--"; never add an agent co-author on commits unless the session's attribution rules say so (this session used `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` per its harness); never hand-edit CHANGELOG or generated files; one sentence per line in long Markdown.
- Every piece of work goes in its own git worktree under `.claude/worktrees/<name>`, named by the user (ask for the issue/name first; the user always picked a name, never an issue).
- When a PR merges: confirm the worktree is clean and its commits are on main, then remove the worktree and delete the branch locally and on the remote.
  Never remove another session's worktree.
- Bug fixes start with an end-to-end reproduction (Playwright against the real stack), then the fix, then a test that fails without the fix.
- Be picky about UI: screenshot at 390, 768, 1024, 1280, 1440 px and fix anything off.
- The user validates and ships with the `no-mistakes` pipeline (`no-mistakes axi run --intent "..."`), then asks the agent to "merge for me and clean the worktree" (merge with `gh pr merge <n> --merge --match-head-commit <sha>`).
- SyncLab now supports only OpenAI and Anthropic as API providers internally, and that must NOT be named on the landing page.
- The user removed local LLMs for good (no Ollama); default `LLM_PROVIDER` should become `gemini` (see section 6).
- Never post anything public (GitHub issues on other repos, etc.) without asking.

## 1. What SyncLab is (context)

An autonomous migration agent:
- **Dependency breaks:** a Dependabot/Renovate npm pull request (or `POST /migrations`) triggers a job.
  The worker runs sandbox phases in locked-down Docker containers (clone, changelog, install, baseline test, upgrade, refactor with an LLM, test loop, publish) and opens a pull request.
- **API breaks (new scope, Phases 5 to 10 in `infra/Architecture/04 - Phased Rollout.md` and `05 - Self-Maintaining API.md`):** scan repos for Anthropic/OpenAI SDK and HTTP usage (shipped in Phase 5, PRs #26/#27), monitor providers for breaking changes (Phase 6a merged as #29, 6b is open PR #32 by another session), then impact analysis and API-change migrations (planned).
- Layout: `server/api` (NestJS gateway + BullMQ worker, Prisma/Postgres, Redis), `server/sandbox` (phase runner image), `web/` (Next.js 16.4.1 dashboard, React 19, Tailwind v4, shadcn), `benchmarks/`, `infra/` (Obsidian vault of design docs).
- `web/AGENTS.md`: this Next.js version has breaking changes; read `web/node_modules/next/dist/docs/` before writing Next code.
  Notable: `middleware.ts` is now `proxy.ts` (Node runtime by default); `cacheComponents: true` keeps visited pages mounted but hidden in React `<Activity>` after client-side navigation (up to 3 routes).

## 2. Work completed in this session (all merged to main)

| PR | Branch (deleted) | What |
| --- | --- | --- |
| #18 | job-page-live-and-tests | Live refresh on job page and dashboard (`components/live-refresh.tsx`, router.refresh every 5s while QUEUED/IN_PROGRESS, paused when tab hidden), `updatedAt` on job page, Vitest added to `web/` (`npm test`), CI step, pipeline-track labels via container queries |
| #21 | job-retry-and-logs | Retry button for FAILED jobs (server action re-reads the job via `GET /migrations/:id`, then `POST /migrations`, which already re-queues FAILED jobs race-safely); log folding (>24 lines folds to last 12, failed steps open), copy button, "Took" duration of the latest run (`latestRunDuration`) |
| #23 | web-e2e-tests | Playwright suite in `web/e2e` (`npm run test:e2e`): global setup starts throwaway postgres:15 + redis:7 containers on Docker-assigned ports, builds and starts the real API (`APP_ROLE=gateway`) and the web app, and a stub for GitHub web host, GitHub REST and npm registry (`e2e/stub.ts`). Fixed ports 3101 web, 3110 API, 3120 stub. Added `GITHUB_URL` and `NPM_REGISTRY_URL` env settings. CI job `web-e2e` in `.github/workflows/verify.yml` |
| #28 | tailwind-postcss | Switched Tailwind from `@tailwindcss/turbopack` loader to `@tailwindcss/postcss` + `web/postcss.config.mjs` (see section 4) |
| #31 | landing-page | Marketing landing page at `/`, dashboard moved to `/dashboard` (see section 3) |

Also done: pulled main into `develop` and pushed it several times (last push in this session: `ba3a35f`; another session later moved develop to `809842b`).

## 3. Landing page (PR #31, merged as 29eadc1): architecture and decisions

Files (all under `web/`):
- `app/page.tsx`: the landing page.
  Always dark (`LandingIntro` root with class `dark`, bg `#07090c`).
  Sections: header (tiled mascot + "SyncLab" wordmark, How it works / FAQ section links, primary action), hero (`HeroField`), How it works (two trigger cards: "A dependency breaks" / "An API breaks", then `PipelineDiagram`), The dashboard (real `RunningJobs` cards with sample data in a window frame), "Careful where it counts" (6 features), FAQ, footer.
- Primary action: "Continue with GitHub" (`GithubSignIn returnTo=/dashboard`) when `signInConfigured()`, else "Open the dashboard".
  The header "Dashboard" text link only shows when sign-in is configured.
- `components/landing/hero-field.tsx`: client canvas.
  Samples `mascotSvg({ tile: false })` at 4x into character cells (majority vote per cell, `cellPart`), fur shaded by `depth()`, ears dim dots, eyes/nose blue `@`, collar tag blue `^`.
  Pup is drawn into an empty slot element (`[data-pup-slot]`); on wide screens its face (FACE_Y 0.52) is aligned to the h1's vertical center, bottom of the bust fades (FADE_FROM 0.9).
  Background dust specks.
  A migration card cycles (`MIGRATIONS`): `package.json` zod ^3.23.8 -> ^4.1.0, generic API call `client.messages.create` model `chat-large-2024-06` -> `chat-large-2026-04` ("model retired"), next 14 -> 15, `client.completions.create` `max_tokens` -> `max_output_tokens` ("parameter renamed").
  Each rewrite scrambles (`scramble`, keeps shared prefix) and dispatches a ripple of version digits through the field.
  Pointer stirs nearby glyphs.
  Pauses offscreen/hidden tab.
  Reduced motion: one still frame, card shows the first migration done.
  Layout runs are guarded by `disposed`, a missing slot check, and a `generation` counter (out-of-order async runs).
- `lib/ascii.ts` (+ `lib/ascii.test.ts`): pure helpers `pupPart`, `cellPart`, `depth`, `hash`, `pick`, `rippleEnergy`, `scramble`, glyph sets.
- `lib/mascot.ts`: `mascotSvg({ tile })` option added (favicon unchanged).
- `components/landing/frame.tsx` (`Band` sections with hairline + crosshair `Tick`s, `Eyebrow`), `pipeline-diagram.tsx` (8 stages, CSS pulse `landing-pulse`/`landing-stop` in `app/globals.css`), `faq.tsx` (native `<details>`), `site-footer.tsx` (Kairos-style: big serif line, framed CTA with corner ticks, Product/Learn/Project link columns incl. the GitHub repo; no logo), `section-link.tsx` (scrolls without pushing history, so Back from the dashboard returns to `/`, not `/#how`), `landing-chrome.tsx` (sets `html` background dark in a layout effect, cleaned up when Activity hides the page), `landing-intro.tsx` (sets `data-intro="playing"` for 2s once per page load; CSS `intro-word`/`intro-fade`/`intro-stagger`/`intro-draw` in `globals.css`; pup decodes from blue digits via `introStart` ref; not replayed on Back; skipped for reduced motion).
- Routing: `app/layout.tsx` is now just html/body/fonts/theme/skip link.
  `app/(app)/layout.tsx` + `components/app-shell.tsx` hold the sidebar.
  Dashboard pages live in `app/(app)/` (`dashboard`, `jobs/[id]`, `migrations/new`, `repositories`, `settings`, `api-changes`, `error.tsx`).
  Root `app/not-found.tsx` wraps itself in `AppShell`.
  `proxy.ts` (matcher `/`) redirects signed-in users and old links with `status`/`repo`/`q` params to `/dashboard`; `lib/session.ts` exports `readSession` and `SESSION_COOKIE` for it.
- Copy decisions by the user: headline "Breaking changes, fixed for you." (no paragraph), eyebrow "Dependency and API migrations"; no provider/model vendor names anywhere; no "Works with" strip; no closing CTA band; FAQ and footer modeled on kairos.trade.
- Research (no copied assets): kairos.trade = Next.js + GSAP + Lenis, hero video under a WebGL2 frost/ASCII shader with a cursor brush; scalpal.tech = Next.js, 2D-canvas ASCII of public-domain Michelangelo hands.
  Neither shows Higgsfield; the Kairos video was ffmpeg re-encoded (no provenance).
- Tests: `e2e/landing.spec.ts` (landing render, signed-in redirect, old-link redirect, migration card cycle, reduced motion, widths 390 to 1440 with pup clear of copy, 404 keeps app shell, FAQ and footer, client-side visit leaves dashboard light and Back returns to `/`, intro plays once and not on Back, intro skipped for reduced motion).
  Other specs moved to `/dashboard`.
  Final state: 41 Playwright tests, 64 unit tests pass.

## 4. Tailwind/Turbopack CSS bug (fixed in PR #28)

- Symptom: edits to `web/app/globals.css` did not show in `next dev` until restart; once a stale production build too.
- Root cause (reproduced in a scratch copy): `@tailwindcss/turbopack` 4.3.3 (latest) caches the compiled stylesheet per file and recompiles only when the file mtime differs from the recorded one, never comparing the source text it is given.
  When the file changes again before the loader stats it, it compiles older text with the newer mtime and serves CSS one edit behind.
  Patching the loader to also compare source fixed it; `@tailwindcss/postcss` passed the same replay.
- Fix: `@tailwindcss/postcss` via `web/postcss.config.mjs`, removed `turbopack.rules` from `next.config.ts`.
  Production CSS byte-identical before/after.
- Not done: the upstream issue on `tailwindlabs/tailwindcss` (user has not approved posting).
- Separate lesson: do not run `next dev` and `next build` in the same `web/` dir at the same time (they share `.next/cache/turbopack`); stop dev and `rm -rf .next/cache/turbopack` before builds/e2e if in doubt.

## 5. Current state (end of session)

- `main` = `29eadc1` (Merge PR #31 landing-page).
- `develop`: main was merged into it as `f9d54bd`, then this handoff was committed on top and pushed; it differs from main only by the handoff notes (`synclab-handoff-1.md`, `synclab-handoff-2.md`, `handoffs/synclab-handoff-3.md`, `handoffs/synclab-handoff-4.md`).
  The main checkout on `develop` has the user's own uncommitted files (`.cursor/*`, `CURSOR.md`, `infra/.obsidian/workspace.json`, `benchmarks/results/workspaces/`, `synclab_benchmark_results.txt`); never touch or commit those.
- Worktrees: only `phase-6-api-change-monitoring` (branch `phase-6b-api-change-monitoring`, open PR #32, another session's) and the old locked `luminous-fluttering-sedgewick` (`feat/manual-trigger-endpoint`, already merged long ago; leave it alone).
- No dev servers left running by this session.
  Docker Desktop was started by this session for the e2e suite.
- Memory notes (Claude Code only): `synclab-github-app.md`, `phase-6-worktree.md`, `no-local-llm.md`.

## 6. Next steps / open items

1. **Landing copy is out of date about local models.** The user removed Ollama for good (default becomes gemini).
   `web/app/page.tsx` feature "Your model, your call" says "Rewrites come from a local model by default, or from a hosted one when you want it", and `web/components/landing/faq.tsx` languages answer says "Rewrites come from a local model by default, or from a hosted one." Offered a small follow-up PR to fix; user has not answered yet.
   Keep vendor names off the page.
2. **Ollama removal PR** (owed after #32 merges, per `no-local-llm` note): remove the `ollama` provider everywhere (config, fenced-reply/context-budget refactor path, `LLM_BASE_URL`/`LLM_NUM_CTX`, container env, tests, benchmark docs, READMEs), default `LLM_PROVIDER=gemini`.
   The user's Gemini key only reaches Flash models on the free tier.
3. **Duplicate route tables:** root `README.md` (Dashboard section) and `web/README.md` (Pages) both list dashboard routes; no-mistakes suggested keeping one.
   Not done.
4. **Upstream Tailwind issue** (section 4): ask before filing.
5. **develop sync:** done at the end of this session.
   Next time: in the main checkout, check main's changes do not overlap the user's uncommitted files, `git merge --no-edit origin/main`, confirm `git diff origin/main HEAD` shows only handoff notes, push only when asked (`git push origin develop`, fast-forward).
6. Known gaps from earlier suggestions (not started): job list paging (API caps at 100 jobs silently), storing per-phase timings/attempt/branch/changed files/model in the DB, cancelling a running job.

## 7. Errors and gotchas seen

- Python Playwright: `time.sleep` blocks event delivery; use `page.wait_for_timeout`.
  Next 16 RSC refresh requests carry `next-router-state-tree`, not `rsc: 1`.
- `kill $(lsof -ti tcp:PORT)` also kills clients connected to that port; use `lsof -ti tcp:PORT -sTCP:LISTEN`.
- `npx` can silently download unrelated packages when `node_modules` is missing; e2e setup runs `node_modules/.bin/{next,prisma}` directly.
- Next's `request.url` reports `localhost`, so OAuth callbacks and tests must use `localhost`, not `127.0.0.1`.
- After main gains schema changes, regenerate Prisma in a worktree (`cd server/api && npm ci && npm run db:generate`) before e2e, or the API build fails.
- no-mistakes: after it rebases/pushes, follow its `branch_sync.next_action`; do not hand-rebase its commits (it refuses "at-risk" commits).
  To bring newer main into a PR branch, merge main on top of the pipeline head, then commit follow-ups.
- When main gains new web routes, check they land inside `app/(app)/` (PR #30's `api-changes` had to be moved there).
