# SyncLab local migration benchmark

Synthetic local fixtures. This is not a production or live-webhook result.
The runner calls the sandbox `refactor` and `test` phases. It does not receive a GitHub webhook, clone a repository, or open a pull request.
A case counts as successful only when AST targeting matches, every file that must change was rewritten, removed APIs are gone, `npm run build` passes, and `npm test` passes within 3 attempts.

- Started: 2026-09-24T03:55:17.590Z
- Model: gemini-3.1-pro-preview
- Max attempts: 3

## Summary

- Total cases: 4
- First-attempt success rate: 100.0% (4/4)
- Final success rate within 3 attempts: 100.0% (4/4)
- Average attempts for successful migrations: 1.00
- AST targeting accuracy: 100.0% (4/4)
- Failures: 0

## Failure categories

None.

## Cases

### easy-lodash-pluck (easy)

- Dependency: lodash@4.17.21
- Files that must change: 1
- AST selected: src/users.js
- AST correct: true
- First attempt passed: true
- Attempts used: 1
- Build passed: true
- Tests passed: true
- Success: true
- Execution time excluding install: 4.4s

### hard-lodash-mixed (hard)

- Dependency: lodash@4.17.21
- Files that must change: 4
- AST selected: src/active.js, src/keep.js, src/lookup.js, src/names.js, src/pairs.js
- AST correct: true
- First attempt passed: true
- Attempts used: 1
- Build passed: true
- Tests passed: true
- Success: true
- Execution time excluding install: 18.8s

### medium-lodash-rename (medium)

- Dependency: lodash@4.17.21
- Files that must change: 2
- AST selected: src/groups.js, src/labels.js, src/names.js
- AST correct: true
- First attempt passed: true
- Attempts used: 1
- Build passed: true
- Tests passed: true
- Success: true
- Execution time excluding install: 9.7s

### medium-uuid-path (medium)

- Dependency: uuid@11.1.0
- Files that must change: 1
- AST selected: src/ids.js
- AST correct: true
- First attempt passed: true
- Attempts used: 1
- Build passed: true
- Tests passed: true
- Success: true
- Execution time excluding install: 4.2s

## Rerun

```bash
cd server/sandbox && npm run build
cd ../.. && node benchmarks/run.mjs
```

Requires `GEMINI_API_KEY` in the environment or in `server/api/.env`.
