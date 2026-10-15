# Local migration benchmark

Synthetic fixtures for the sandbox refactor/test loop. These are not production webhook results.

Each case installs the target package version while the source still calls a removed API. Cases marked `"upgrade": true` instead start on the old version and run the sandbox's `upgradeDependency` step first, so they only pass if `package.json` and `node_modules` end at the target version. The runner then uses the real sandbox `refactor` and `test` phases, up to 3 attempts, and requires `npm run build` plus `npm test`.

```bash
cd server/sandbox && npm run build
cd ../.. && node benchmarks/run.mjs
```

By default it uses Ollama on `localhost:11434` with `qwen2.5-coder:14b` (override with `LLM_MODEL` or `BENCHMARK_LLM_BASE_URL`).
With `LLM_PROVIDER=gemini`, `GEMINI_API_KEY` must be set, or present in `server/api/.env`.
Raw output is `benchmarks/results/results.json`.
The summary is `benchmarks/results/report.md`.
