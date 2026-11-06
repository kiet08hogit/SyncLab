# Phase 10 progress

Implementation branch: `codex/phase10-dashboard-dogfood`.
Worktree: `/private/tmp/SyncLab-phase10-dashboard-dogfood`.

Repository API usage and impact pages, manual scan controls, dashboard metrics, and authenticated Prometheus metrics are implemented.
The latest `origin/main` Phase 9 changes are merged into this branch.

## Live completion run

The GitHub App installation `171963616` covers `kiet08hogit/SyncLab` (repository ID `1314509310`).
A signed replay of an installation event connected it to the isolated local runtime.
Scan `8b5ec383-673c-44e9-b233-f7742612039d` completed at commit `7d832698dd9d4219695db2af39ea71b16e84916b` and recorded the Anthropic streaming call in `server/sandbox/src/llm/refactor-chain.ts`.

The controlled fixture simulates removal of the Anthropic Messages `fallbacks` parameter.
It is not an actual provider announcement.
`server/api/scripts/replay-phase10.mjs` replays the before and after snapshots with hand-authored classifier output, verifies the evidence through the monitor, and stores the detected change.
It is guarded to run only against the isolated local database on port 55432.

Change `329d32e7-d129-46a0-8e36-5dce658cb5e8` was confirmed through the API.
Its confirmed impact includes SyncLab and started migration job `2e0f9245-b780-46e8-9676-fb58eccff406`.
No migration PR has been verified yet.
The configured Gemini credential returned HTTP 401 during live classification, and no Anthropic credential is configured.
A working model credential is required to finish the migration and PR gate.

## Runtime handles

The local API and worker run on port 3210 with provider polling disabled.
The isolated Docker containers are `synclab-phase10-postgres` (port 55432) and `synclab-phase10-redis` (port 56379).
The sandbox image is `synclab-sandbox:phase10`.
The API worktree reads the existing development `.env` through a symlink; credentials are not committed.
After updating the model credential, restart the API process with the same isolated database, Redis, image, and port settings.
Inspect the existing migration job and retry its BullMQ job if it has failed; preserve its repository/change identity.
Do not substitute a manually opened PR for the worker's publish phase.

## Verification

The real API browser test checks scanned calls, impacts, migration and PR links, metrics, and manual scanning.
It passes at mobile and desktop widths without horizontal overflow.
The affected backend tests, TypeScript checks, lint checks, and sandbox install/test/upgrade/typecheck checks pass.
Security review found no concrete vulnerabilities.
Code review found package resolution gaps across SDK upgrade and validation and a workspace-root regression; those were corrected and their affected checks rerun.
Phase 10 remains incomplete until the worker publishes a migration PR on SyncLab.
