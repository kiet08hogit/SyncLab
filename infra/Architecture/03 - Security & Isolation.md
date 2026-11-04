# 03 - Security & Isolation

SyncLab processes untrusted repositories and may execute their dependency install scripts and test suites.
The NestJS worker orchestrates those steps through Docker and never runs repository code in its own process.
The same boundaries protect dependency migrations, repository scans, and API-change migrations in [[05 - Self-Maintaining API]].

## Phase-specific containers

Each phase starts a short-lived container from the same sandbox image and shares only a named Docker volume at `/workspace` with the other phases of that job.
No sensitive host directory is bind-mounted.
Containers run as the `node` user, drop Linux capabilities, forbid privilege escalation, and have memory, CPU, process-count, and time limits.

| Phase | Network | GitHub token | Model key |
| --- | --- | --- | --- |
| `prepare`, `clone`, `publish` | yes | short-lived installation token | no |
| `install`, `upgrade` | yes, for package retrieval | no | no |
| `refactor`, `classify` | yes, for the model | no | selected model key |
| `scan`, `test`, `validate` | no | no | no |

`install` and `upgrade` can run untrusted package lifecycle scripts, so they keep registry network access but never receive GitHub or model credentials.
`test` executes repository code with no network and no credentials.
`scan` parses source without executing it, and `validate` runs SyncLab's checks without a network connection.
`classify` reads provider text, not repository code.

## GitHub access and publication

The worker mints a short-lived GitHub App installation token for the repository it is processing.
Only phases that clone or publish receive that token.
The App's private key stays in the worker, and repository reads exposed through the gateway are limited to repositories the caller's installation can reach.
Before publishing, SyncLab makes a fresh clone at the commit recorded by `prepare` rather than trusting the checkout that untrusted install scripts and tests could have modified.
See `server/api/src/worker/sandbox/container-options.ts` for the enforced phase policy and `server/api/src/worker/sandbox/docker-sandbox.service.ts` for container orchestration.

## Validation boundary

A passing test suite does not prove a provider API call is still valid.
The API-change validator rescans the migrated tree, checks supported OpenAI request schemas, and typechecks TypeScript when the job names a required SDK release, without calling a live provider.
Running repository code with provider network access and a provider key would break the isolation model, so live API calls are outside this validation path.
