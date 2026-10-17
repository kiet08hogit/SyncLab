# Migration benchmark

Measures how often SyncLab's real migration pipeline repairs a project after a dependency's breaking release.
Every case runs through the worker's own sandbox driver and the production `synclab-sandbox` image, in the same phase order as a real job.
The latest results are in [`results/report.md`](results/report.md).

## What a case is

```
cases/<id>/
  case.json   package, fromVersion, toVersion, category, difficulty, a description of the break and a link to its changelog
  repo/       the only files the sandbox sees: package.benchmark.json and package-lock.benchmark.json (seeded as package.json and package-lock.json), src/, test/
  solution/   a reference fix (changed non-test files only), used by validation and never by the benchmark run
```

`repo/` is pinned to the old version with a lockfile.
Its `node:test` suite imports only the project's own code, never the dependency, so the refactor step cannot rewrite it.

The manifest and lockfile are committed as `package.benchmark.json` and `package-lock.benchmark.json` so GitHub's dependency graph and dependency review skip these deliberately old (and sometimes vulnerable) versions.
GitHub parses both `package.json` and `package-lock.json`, so both have to be renamed.
When a case is seeded into its Docker volume, the files are renamed back to `package.json` and `package-lock.json`, so the sandbox sees an ordinary npm project.
To create a case, write `repo/package.json` pinned to the old version, generate its lockfile, then rename both:

```bash
(cd benchmarks/cases/<id>/repo && npm install --package-lock-only --ignore-scripts && mv package.json package.benchmark.json && mv package-lock.json package-lock.benchmark.json)
```

To refresh an existing case's lockfile, rename `package.benchmark.json` back to `package.json` first and run the same command.

## Running it

Prerequisites: Docker, the API and sandbox built, and the model the worker is configured for (by default Ollama with `qwen2.5-coder:14b`).

```bash
# from the repository root
(cd server/api && npm ci && npm run db:generate && npm run build)
(cd server/sandbox && npm ci && npm run build)
docker build -t synclab-sandbox:bench server/sandbox

node benchmarks/validate.mjs      # prove each case: passes on old, breaks on new, passes with the reference fix
node benchmarks/fetch-notes.mjs   # snapshot the release notes production would fetch (needs GITHUB_TOKEN or gh auth)
node benchmarks/run.mjs           # run the pipeline on every valid case; add --resume to continue an interrupted run
node benchmarks/report.mjs        # write results.csv, summary.json and report.md from results.json
```

`--only=<id,id>` limits validation, note fetching and runs to some cases.
The runner uses the worker's default configuration, so set `LLM_PROVIDER`, `LLM_MODEL` and the provider's key to benchmark another model.

## How it stays honest

- **Validated cases only.** A case is scored only if its suite passes on the old version, fails after the upgrade alone, and passes with the reference fix, all in the sandbox.
- **The real pipeline.** `install`, a baseline `test`, `upgrade`, then `refactor` and `test` up to `LLM_MAX_ATTEMPTS` times, through `DockerSandboxService` with the production container options. Only `prepare` (clone) and `publish` (push and pull request) are skipped.
- **No hints.** The model gets only what production gives it: the files, their dependency usage, the release notes production would fetch (snapshotted in `notes/`), and the previous test output on a retry. The case description and the reference fix never enter the sandbox.
- **No leakage between cases.** Each case gets a fresh Docker volume that is deleted afterwards.
- **No test tampering.** Test files are hashed before and after; a migration that edits a test fails even if the suite passes.

## Outputs

| File | Contents |
| --- | --- |
| `results/validation.json` | per-case validation checks |
| `results/results.json` | run metadata (commit, model digest, image, limits) and every case's attempts, timings and failure reason |
| `results/results.csv` | one row per case |
| `results/summary.json` | the headline numbers |
| `results/report.md` | methodology, results and limitations |
