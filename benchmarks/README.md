# Local migration benchmark

Synthetic fixtures for the sandbox refactor/test loop. These are not production webhook results.

Each case installs the target package version while the source still calls a removed API. The runner then uses the real sandbox `refactor` and `test` phases, up to 3 attempts, and requires `npm run build` plus `npm test`.

```bash
cd server/sandbox && npm run build
cd ../.. && node benchmarks/run.mjs
```

`GEMINI_API_KEY` must be set, or present in `server/api/.env`. Raw output is `benchmarks/results/results.json`. The summary is `benchmarks/results/report.md`.
