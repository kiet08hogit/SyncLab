# SyncLab migration benchmark report

Generated from `results.json` by `benchmarks/report.mjs`. Every number below is computed from the recorded per-case results; nothing is estimated or hand-entered.

## Setup

| | |
| --- | --- |
| Run | 2026-10-16T21:28:36.635Z to 2026-10-17T00:16:29.082Z |
| Base commit | `756ead67496d`, then `0a41d334e539` (the run was resumed; the later commit only changed the benchmark harness) |
| Model | 6 models, one per case (see By model); first: gemini `gemini-3.5-flash` (chosen with `LLM_MODEL`, not the worker's default for this provider) |
| Attempts per case | up to 3 (the worker's default `LLM_MAX_ATTEMPTS`) |
| Sandbox | image `synclab-sandbox:bench` (`e7c6e2f672d9`), 2 GB memory, 1 CPU, 512 PIDs, 10 min per phase |
| Host | darwin/arm64, 15 CPUs; harness on Node v24.18.0, phases on the image's Node 22 |
| Cases | 60 scored across 33 packages (60 passed validation) |

## Results

| Metric | Value |
| --- | --- |
| First-attempt test pass rate | 19/60 (31.7%) |
| Success rate after retries | 46/60 (76.7%) |
| Mean migration time | 50.5s |
| Median migration time | 9.0s |
| 90th percentile migration time | 136.5s |
| Mean migration time, successful cases | 44.8s |

Successful cases by the attempt that passed: attempt 1: 19, attempt 2: 20, attempt 3: 7.

Release notes were found for 32 of 60 cases. Success with notes: 22/32 (68.8%); without: 24/28 (85.7%). This is not a controlled comparison: the two groups contain different packages, difficulties and models.

### Failure reasons

| Reason | Cases | Meaning |
| --- | --- | --- |
| `tests_failed` | 11 | the model changed code but the suite still failed after the last attempt |
| `no_changes` | 3 | the model left every file unchanged on every attempt |

### By model

| model | Cases | First-attempt pass | Success after retries | Mean migration time |
| --- | --- | --- | --- | --- |
| gemini/gemini-3.5-flash-lite | 39 | 15 (38.5%) | 28 (71.8%) | 6.9s |
| gemini/gemini-3.5-flash | 5 | 0 (0.0%) | 5 (100.0%) | 46.9s |
| gemini/gemini-3.7-flash | 5 | 1 (20.0%) | 4 (80.0%) | 129.7s |
| gemini/gemini-3.8-flash | 5 | 2 (40.0%) | 5 (100.0%) | 168.3s |
| gemini/gemini-2.5-flash | 4 | 1 (25.0%) | 3 (75.0%) | 56.8s |
| gemini/gemini-3-flash-preview | 2 | 0 (0.0%) | 1 (50.0%) | 403.6s |

### By difficulty

| difficulty | Cases | First-attempt pass | Success after retries | Mean migration time |
| --- | --- | --- | --- | --- |
| medium | 21 | 7 (33.3%) | 13 (61.9%) | 22.2s |
| easy | 20 | 10 (50.0%) | 19 (95.0%) | 14.8s |
| hard | 19 | 2 (10.5%) | 14 (73.7%) | 119.3s |

### By category

| category | Cases | First-attempt pass | Success after retries | Mean migration time |
| --- | --- | --- | --- | --- |
| removed-api | 16 | 11 (68.8%) | 13 (81.3%) | 7.3s |
| behavior-change | 10 | 1 (10.0%) | 7 (70.0%) | 104.2s |
| esm-only | 8 | 0 (0.0%) | 4 (50.0%) | 65.4s |
| default-export-change | 7 | 0 (0.0%) | 6 (85.7%) | 14.0s |
| renamed-api | 7 | 2 (28.6%) | 7 (100.0%) | 44.8s |
| signature-change | 7 | 4 (57.1%) | 5 (71.4%) | 119.4s |
| async-api | 4 | 0 (0.0%) | 3 (75.0%) | 24.4s |
| option-change | 1 | 1 (100.0%) | 1 (100.0%) | 4.1s |

### By package

| package | Cases | First-attempt pass | Success after retries | Mean migration time |
| --- | --- | --- | --- | --- |
| lodash | 13 | 8 (61.5%) | 11 (84.6%) | 6.2s |
| ramda | 4 | 3 (75.0%) | 4 (100.0%) | 5.5s |
| express | 3 | 1 (33.3%) | 1 (33.3%) | 247.5s |
| query-string | 3 | 0 (0.0%) | 0 (0.0%) | 9.6s |
| ajv | 2 | 0 (0.0%) | 2 (100.0%) | 83.8s |
| date-fns | 2 | 1 (50.0%) | 2 (100.0%) | 252.7s |
| joi | 2 | 1 (50.0%) | 1 (50.0%) | 73.2s |
| js-yaml | 2 | 2 (100.0%) | 2 (100.0%) | 3.9s |
| lru-cache | 2 | 1 (50.0%) | 2 (100.0%) | 4.4s |
| nanoid | 2 | 0 (0.0%) | 1 (50.0%) | 6.7s |
| node-fetch | 2 | 0 (0.0%) | 1 (50.0%) | 10.5s |
| uuid | 2 | 1 (50.0%) | 1 (50.0%) | 6.1s |
| chalk | 1 | 0 (0.0%) | 1 (100.0%) | 29.6s |
| commander | 1 | 0 (0.0%) | 1 (100.0%) | 19.4s |
| cookie | 1 | 0 (0.0%) | 1 (100.0%) | 18.1s |
| csv-parse | 1 | 0 (0.0%) | 1 (100.0%) | 60.7s |
| decamelize | 1 | 1 (100.0%) | 1 (100.0%) | 98.1s |
| deepmerge | 1 | 0 (0.0%) | 1 (100.0%) | 177.4s |
| dotenv | 1 | 0 (0.0%) | 1 (100.0%) | 143.3s |
| escape-string-regexp | 1 | 0 (0.0%) | 1 (100.0%) | 71.4s |
| execa | 1 | 0 (0.0%) | 1 (100.0%) | 372.1s |
| filenamify | 1 | 0 (0.0%) | 1 (100.0%) | 126.4s |
| glob | 1 | 0 (0.0%) | 1 (100.0%) | 73.1s |
| immer | 1 | 0 (0.0%) | 1 (100.0%) | 7.5s |
| marked | 1 | 0 (0.0%) | 1 (100.0%) | 4.4s |
| mime | 1 | 0 (0.0%) | 1 (100.0%) | 6.9s |
| minimatch | 1 | 0 (0.0%) | 1 (100.0%) | 5.5s |
| mkdirp | 1 | 0 (0.0%) | 0 (0.0%) | 7.1s |
| path-to-regexp | 1 | 0 (0.0%) | 0 (0.0%) | 10.3s |
| prettier | 1 | 0 (0.0%) | 1 (100.0%) | 5.9s |
| redux | 1 | 0 (0.0%) | 0 (0.0%) | 6.8s |
| rimraf | 1 | 0 (0.0%) | 1 (100.0%) | 11.6s |
| ws | 1 | 0 (0.0%) | 1 (100.0%) | 16.7s |

### Failed cases

| Case | Reason | Attempts | Files changed |
| --- | --- | --- | --- |
| `express-4-to-5-req-param-del` | `tests_failed` | 3 | `src/app.js` |
| `express-4-to-5-wildcard-redirect` | `tests_failed` | 3 | `src/routes/files.js`, `src/routes/legacy.js` |
| `joi-14-to-17-error-types` | `tests_failed` | 3 | `src/orders.js`, `src/schemas.js` |
| `lodash-3-to-4-flatten-callback-assign` | `tests_failed` | 3 | `src/config.js`, `src/filters.js`, `src/permissions.js` |
| `lodash-3-to-4-thisarg` | `tests_failed` | 3 | `src/currency.js`, `src/expenses.js` |
| `mkdirp-0-to-1-promise` | `tests_failed` | 3 | `src/storage.js` |
| `nanoid-2-to-3-custom-alphabet` | `tests_failed` | 3 | `src/invites.js`, `src/trace.js` |
| `node-fetch-2-to-3-api-clients` | `tests_failed` | 3 | `src/api.js`, `src/retry.js`, `src/status.js`, `src/webhooks.js` |
| `path-to-regexp-1-to-6-named-export` | `tests_failed` | 3 | `src/links.js`, `src/router.js` |
| `query-string-7-to-9-default-export` | `no_changes` | 3 | none |
| `query-string-7-to-9-read-write` | `tests_failed` | 3 | `src/links.js` |
| `query-string-7-to-9-url-helpers` | `no_changes` | 3 | none |
| `redux-4-to-5-string-action-types` | `no_changes` | 3 | none |
| `uuid-3-to-11-v4-import` | `tests_failed` | 3 | `src/ids.js` |

## Methodology

**Cases.** Each case is a small project pinned (with a lockfile) to an older release of one npm package whose newer release has a real breaking change: a removed or renamed API, a changed signature or default export, an ESM-only release, or a behaviour change. The project has its own `node:test` suite that only imports the project's code, never the dependency.

**Validation before scoring.** `benchmarks/validate.mjs` runs every case in the same sandbox, without any model, and a case is scored only if (1) its suite passes on the old version, (2) the suite fails after the upgrade alone, proving the break is real, and (3) the suite passes again with the reference fix in `solution/` applied, proving the case is solvable. Cases that fail any check are excluded.

**The pipeline under test.** `benchmarks/run.mjs` loads the compiled worker's own `DockerSandboxService` and configuration and runs each case through the same phases and order as a real job: `install` (lifecycle scripts, no token), a baseline `test`, `upgrade` to the exact target version, then `refactor` and `test` alternating up to 3 attempts, with each failing test output passed to the next refactor attempt. Each phase is a fresh container from the production sandbox image with the production limits; test phases have no network. Only `prepare` (clone) and `publish` (push and pull request) are not run: the checkout is seeded from the case instead.

**Release notes.** The model receives the release notes production would fetch, not a hand-written hint. `benchmarks/fetch-notes.mjs` ran production's `fetchReleaseNotes` once per case (npm registry, then the GitHub release for the target tag) and stored the result, or production's fallback sentence when nothing was found, in `benchmarks/notes/`. Every run reuses these snapshots.

**Isolation and leakage.** Every case gets a new Docker volume containing only `package.json`, the lockfile, `src/` and `test/`. The case description, the reference fix and the validation results never enter the sandbox, and the volume is deleted afterwards, so nothing carries over between cases. The model is stateless between calls. Test files are hashed before and after: a migration that edits a test is a failure even if the suite passes.

**Rate limits.** A rate-limited model call is retried after 2 and then 4 minutes, as BullMQ retries a rate-limited job in production. The waits are excluded from migration time. Production re-runs the whole job on a retry; the benchmark retries only the refactor attempt that was limited, which leads to the same outcome without repeating the earlier phases.

**Metrics.** Success means the project's existing test suite passes after the migration and no test file changed. First-attempt pass means it passed after the first refactor. Migration time runs from the start of `upgrade` to the end of the last test run (install and baseline excluded); it includes container start-up and model latency on this host.

## Limitations

- **This run mixed 6 models** (`gemini/gemini-3.5-flash`, `gemini/gemini-3.8-flash`, `gemini/gemini-3.7-flash`, `gemini/gemini-3-flash-preview`, `gemini/gemini-2.5-flash`, `gemini/gemini-3.5-flash-lite`), because the provider's free tier allows only a few requests per model per day. Each case ran on exactly one model (see "By model" and the `model` column in `results.csv`), cases were assigned to models in alphabetical order rather than at random, and the overall rates are a blend, not the score of any single model.
- The cases are small synthetic projects (one dependency, a few files). Real repositories are larger, have more dependencies and slower suites, so these times and rates do not transfer directly.
- Package selection was made by the benchmark authors and leans on well-known Node libraries with documented breaks; it is not a random sample of real-world upgrades.
- Results are for 6 hosted models (chosen with `LLM_MODEL`, not the worker's default model), run on one machine. Model output can differ between runs, and timings depend on the host's hardware and load.
- Dependency installs resolve against the live npm registry, so transitive versions of packages introduced by the upgrade can change over time.
- Release notes are a snapshot taken once; production fetches them per job, and they can change upstream.
- The suite is the only success criterion, as in production. A migration can pass a weak suite without being fully correct; the case suites were written to exercise the changed APIs, but they are not exhaustive.
- `prepare` and `publish` are not exercised, so clone, push and pull request failures are out of scope.
