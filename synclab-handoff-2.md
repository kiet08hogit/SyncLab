# SyncLab handoff 2 (Claude Code to Cursor CLI)

Written 2026-10-17.
Repository: `/Users/hokiet.nguyen/Documents/side projects/SyncLab` (GitHub `kiet08hogit/SyncLab`, default branch `main`, integration branch `develop`).

## 1. Context

SyncLab is a GitHub App that migrates repositories through dependency upgrades with an LLM, running each step in a Docker sandbox.
Stack:
- `server/api`: NestJS API and worker (Prisma 7 on Postgres, BullMQ on Redis, Jest tests).
- `server/sandbox`: the code that runs inside the sandbox container (ESM, `node:test`), one phase per container run via `DockerSandboxService.runPhase`.
- `web/`: Next.js dashboard (Playwright e2e in `web/e2e`).
- `infra/Architecture/`: the design docs (Obsidian vault). `04 - Phased Rollout.md` is the roadmap; `05 - Self-Maintaining API.md` is the Phase 6 to 8 design and holds the "Monitoring endpoints" contract the UI is built against.

Owner rules (from `AGENTS.md` and `CLAUDE.md`, which you must follow):
- Never use the em dash; use `--`.
- Never add the agent as co-author unless the session's attribution rules require it.
- Never hand-edit CHANGELOG.md or generated files.
- In long Markdown, one sentence per line.
- Prefer quality, simplicity and robustness over development cost.
- Reproduce bugs end to end before fixing; fix lint, test failures and flakiness you see even if unrelated; be pixel-perfect in UI.
- Before creating a worktree, ask which issue (the owner usually says "no issue" and names it by topic).
- After a worktree's PR merges: confirm it is clean and its commits are on `main`, then remove the worktree and delete the branch locally and on the remote.
  Never remove a worktree or branch that belongs to another session.
- Commit or push only when asked.
- Surgical changes; touch only what the task needs.

The owner validates PRs with the `no-mistakes` tool (see section 4).

## 2. Completed work and progress

Earlier in this conversation (all merged into `main`):
- PR #25 (benchmark) merged; its worktree removed.
- `main` merged into `develop` locally (commit `809842b`).
- Phase 6a, PR #29 (merged as `75c3725`): API change monitoring backbone.
  - Migration `20261017000000_api_change_monitor`: tables `api_sources`, `api_source_snapshots`, `breaking_changes`; seeds the Anthropic and OpenAI deprecations pages.
  - `server/api/src/monitor/deprecations.ts`: `extractTables`, `normalizeTables`, `parseDeprecations`, `parseDate`, `extractIds`, `subjectKey`.
  - `api-monitor.service.ts` (polling, hashing, snapshot only on content-hash change), `api-changes.queries.ts`.
  - `src/gateway/api-changes.controller.ts`: `GET /api-providers`, `POST /api-providers/poll` (BullMQ jobId `manual-poll`), `GET /api-changes`.
  - `src/worker/api-monitor.processor.ts`: BullMQ `upsertJobScheduler`, `API_MONITOR_INTERVAL_MS` (default 6h), `API_MONITOR_ENABLED`.
  - Recorded fixtures under `src/monitor/fixtures/` (Anthropic deprecations 2026-09-26 and 2026-10-01, OpenAI 2026-10-17).
  - `htmlparser2` pinned to `^9` (v12 is ESM-only and breaks Jest).
- PR #30 (Phase 6 dashboard UI, built by a separate session the owner ran) and PR #31 (landing page) are merged into `main`.

Phase 6b, PR #32, **open, CI green, waiting for the owner to review and merge**:
https://github.com/kiet08hogit/SyncLab/pull/32 (branch `phase-6b-api-change-monitoring`).
Validated by `no-mistakes` run `01M55VX7286FNHB3EJ67D8H8B7`, outcome `checks-passed`; pushed head `467d136`.
Commits on the PR:
- `78410a0` the Phase 6b feature commit (the owner's commit, rebased by the pipeline; local copy is `d1f955b`).
- `4a57f12` no-mistakes(review): restrict confirm/dismiss to admins and refuse ollama classify early.
- `0683514` no-mistakes(document): sync root README with Phase 6b monitor sources.
- `467d136` no-mistakes(document): add scan, clone and classify rows to the phase isolation table.

What Phase 6b adds:
- Migration `20261018000000_api_change_sources` seeds more sources:
  - spec: `https://raw.githubusercontent.com/openai/openai-openapi/main/openapi.json`
  - release_notes: `https://platform.claude.com/docs/en/release-notes/overview`, `https://developers.openai.com/api/docs/changelog`
  - sdk_changelog: `https://raw.githubusercontent.com/anthropics/anthropic-sdk-typescript/main/CHANGELOG.md`, `https://raw.githubusercontent.com/openai/openai-node/main/CHANGELOG.md`
- `src/monitor/openapi-spec.ts`: `extractSurface(spec)` and `diffSurfaces(prev, cur)`; kinds `endpoint_removed`, `param_removed`, `param_now_required`, `enum_value_removed`; operation looks like `POST /v1/...`; a removed enum value is `field` = `name=value`.
- `src/monitor/release-notes.ts`: `extractText(body, 'html'|'markdown')` (headings keep their level as `#` marks), `addedSections(prev, cur)` (heading stack, so a section reads `Changelog / 0.123.0 (2026-09-01) / Features`), `verifyClassified(candidates, snapshotContent)` (drops anything whose evidence is not verbatim in the snapshot, under 20 chars, or malformed).
- `src/monitor/api-monitor.service.ts` rewritten:
  - `PageFetcher = (url, accept) => Promise<string>`; `acceptFor(kind)` sends `application/json` for spec, `text/plain, text/markdown` for sdk_changelog, `text/html` otherwise (widening Accept made the docs sites return markdown and broke deprecations).
  - Per kind: deprecations parse to `confirmed` (zero changes throws); spec diffs (first snapshot is a baseline) to `confirmed`; release_notes and sdk_changelog are classified against the previous snapshot to `detected`.
  - Re-baseline guard: if more than half the lines (`REBASELINE_SHARE = 0.5`, at least `REBASELINE_MIN_LINES = 40`) are new, store as a baseline, do not classify (a page switching from markdown to HTML once produced spurious changes).
  - A failed classification throws, so no snapshot is stored and the next poll retries.
  - In the transaction: `pg_advisory_xact_lock(hashtext(sourceId))`, then re-check the latest hash still equals the one diffed against.
  - `detected` changes never overwrite existing rows; unique key is `(providerId, kind, subjectKey)` with `subjectKey = operation|field`.
  - `MAX_PAGE_BYTES` 20 MB.
- `api-changes.queries.ts`: `setStatus(id, status)` (updateMany then findUniqueOrThrow; null for unknown id), shared `toChangeView`, `CHANGE_INCLUDE`.
- `api-changes.controller.ts`: `POST /api-changes/:id/confirm` and `/dismiss` (200, `ParseUUIDPipe`, 404 for unknown).
  - Admin-only (owner's decision): service caller (`MIGRATIONS_API_TOKEN`) or a user whose GitHub login is in `MONITOR_ADMIN_LOGINS` (comma-separated, case-insensitive). Others get 403.
  - `GET /api-changes` items now carry `canReview: boolean`.
- Sandbox phase `classify` (`src/worker/sandbox/{sandbox.types,container-options,docker-sandbox.service}.ts`):
  - Network for the model only, no repository code, no GitHub token; input is base64 JSON in `CLASSIFY_INPUT`, text capped at 48 KB (`MAX_CLASSIFY_TEXT_BYTES`).
  - `DockerSandboxService.classify` refuses `LLM_PROVIDER=ollama` before starting a container; classify env has no `LLM_BASE_URL`/`LLM_NUM_CTX`.
- `server/sandbox`: `src/llm/classify-chain.ts` (Gemini `withStructuredOutput`, Anthropic `output_config` json_schema; ollama rejected with `PermanentModelError`), `src/phases/classify.ts`, `config.ts`, `main.ts`, `result.ts`.
  - `src/llm/errors.ts` `isRetryableModelError` now retries `APIConnectionError`/`APIConnectionTimeoutError` and socket codes (ECONNREFUSED, ECONNRESET, ETIMEDOUT, EAI_AGAIN, EPIPE) up to 3 levels down the cause chain (this was a pre-existing bug on main too).
- Fixtures: OpenAI spec pair `openai-openapi-35060f5b/6ca9cb2b.json.gz` (gives exactly two `param_removed spend_control`), Anthropic SDK changelog pair, a hand-labelled and a real Gemini classification of SDK 0.123.0, release-notes pages from 2026-10-17.
- Docs: `server/api/README.md` (Monitoring API changes, endpoints table), `server/api/.env.example`, `05 - Self-Maintaining API.md` (contract, including: spec removals quote the previous snapshot, not the linked one), root README phases list and phase isolation table.

Verification done for 6b: API 383 tests and sandbox 217 tests passing, lint and typecheck clean (before the pipeline fixes; the pipeline re-ran tests and CI is green).
Live run against a throwaway Postgres/Redis: all 7 sources fetched; deprecations 20 + 161 confirmed; spec baselined; the classifier found 3 detected changes in the Anthropic SDK changelog since 2026-08-31; confirm/dismiss worked over HTTP; a repeat poll stored nothing new.
The throwaway containers and the `synclab-sandbox:p6b` image were removed.

Also done: Ollama and its models were uninstalled from the owner's Mac.

## 3. Branches and worktrees

- Main checkout: `develop` at `809842b` (same as `origin/develop`). It has unrelated uncommitted owner changes (`.cursor/`, `CURSOR.md`, `infra/.obsidian/workspace.json`, `benchmarks/results/workspaces/`, `synclab_benchmark_results.txt`); leave them alone.
  `develop` is behind `origin/main` by 14 commits (PR #30, #31 merges); merge main into develop when the owner asks.
- `.claude/worktrees/phase-6-api-change-monitoring` on branch `phase-6b-api-change-monitoring`, local head `d1f955b`.
  The local branch has diverged from the pushed PR head `467d136` only because the pipeline rebased onto newer main; it has no unique work. Do not reconcile by hand; it is deleted after merge.
- `.claude/worktrees/luminous-fluttering-sedgewick` on `feat/manual-trigger-endpoint`: belongs to another session. Do not touch.
- no-mistakes gate repo: `/Users/hokiet.nguyen/.no-mistakes/repos/820d6cf16d4c.git` (pipeline commits live here).

## 4. Architectural decisions

- Phase 6 built as two sequential PRs (6a, 6b) in one worktree; Phase 7 (impact analysis) starts only after Phase 6 is merged.
- A separate session builds the monitor UI against the "Monitoring endpoints" contract in the 05 doc.
- Snapshots store normalized content (not raw HTML) and are written only when the content hash changes, so page chrome never registers as a change and every evidence quote is checkable.
- Deterministic sources (deprecations tables, OpenAPI spec) produce `confirmed` changes; model-read sources (release notes, SDK changelogs) produce `detected` changes that an admin confirms or dismisses. Confirmed changes will drive Phase 8 migrations.
- The classifier runs as a sandbox phase so the model never sees repo code or a token, and the API verifies every quote verbatim, so a model cannot invent a change.
- Confirm/dismiss are admin-only because a breaking change is global across installations.
- No local LLM: Ollama is gone for good; only hosted providers (Gemini, Anthropic); default provider should become `gemini`.
- `no-mistakes` workflow: `no-mistakes axi run --intent "..."`, then at each `gate:` answer with `no-mistakes axi respond --action approve|fix|skip [--findings ids --instructions "..."]` (use `--wait 9m`, run long). Relay `ask-user` findings to the owner verbatim and let them decide. Never edit code yourself while a run is active. Stop at `checks-passed` and ask the owner to merge.

## 5. Current task and next steps

Current: PR #32 waits for the owner's review and merge. The no-mistakes CI monitor keeps watching it and rebases it automatically if `main` moves (PR #31 merged after the push); do not hand-rebase.

Next, in order:
1. Before or at merge, the owner should set `MONITOR_ADMIN_LOGINS=kiet08hogit` wherever the API runs; otherwise only the service token can confirm or dismiss.
2. Dashboard follow-up (UI from PR #30 predates this): hide confirm/dismiss when `canReview` is false, and handle a 403. The owner may hand this to the UI session.
3. After PR #32 merges: confirm the worktree is clean and its work is on `main`, then remove `.claude/worktrees/phase-6-api-change-monitoring`, and delete branch `phase-6b-api-change-monitoring` locally and on origin (also make sure `phase-6a-api-change-monitoring` is gone). Update the `phase-6-worktree` memory note.
4. Ollama-removal PR, branched from `main`: remove the `ollama` provider everywhere (config and `loadLlmConfig`, the fenced-reply and context-budget refactor path, `LLM_BASE_URL`, `LLM_NUM_CTX`, container env in `container-options.ts`, tests, benchmark docs, READMEs, `.env.example`), and make `gemini` the default `LLM_PROVIDER`. Validate with no-mistakes.
5. Phase 7 (impact analysis), per `04 - Phased Rollout.md` and `05 - Self-Maintaining API.md`. Ask the owner about a worktree first.

## 6. Errors, blockers, unresolved issues

- The owner pasted a Gemini API key in chat earlier. Never write it to a file; pass keys via env vars only. Advise rotating it.
- The key only has free quota for Gemini Flash models (`gemini-3.1-pro-preview` has 0 free quota), so local runs need `LLM_MODEL` set to a Flash model (the live 6b run used `gemini-3.5-flash-lite`). `server/api/.env` holds an older key.
- GitHub App credentials live in `~/.config/synclab/synclab-kiet08hogit/`; never commit them.
- `server/api` has 15 pre-existing `npm audit` vulnerabilities (out of scope so far).
- Lessons from 6b worth keeping in mind: `prisma format` reformats unrelated models (append new models by hand); dotenv log output can pollute values captured from scripts; ESLint reformatting breaks text anchors for scripted patches.
- No blockers. The only pending gate is the owner's merge of PR #32.
