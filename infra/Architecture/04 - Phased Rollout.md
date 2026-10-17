# 04 - Phased Rollout

A step-by-step roadmap for executing the project, focusing on core infrastructure reliability before moving to AI integration.

### Phase 1: Core Infrastructure MVP (Zero AI)
- **Goal:** Build a robust, fault-tolerant pipeline that can clone a repo and run a hardcoded script in a sandbox.
- **Steps:**
  1. Provision PostgreSQL and Redis.
  2. Implement the NestJS Gateway to accept webhook events, validate them, and persist a `MigrationJob` in PostgreSQL.
  3. Implement the BullMQ queue integration in the Gateway.
  4. Create the NestJS Worker service to consume jobs and update DB status (`QUEUED` -> `IN_PROGRESS` -> `COMPLETED`).
  5. Implement programmatic Docker spawning in the worker to run a simple alpine container that outputs "Hello World", capturing logs to `ExecutionLogs`.

### Phase 2: Sandbox Isolation & GitHub Integration
- **Goal:** Prove we can safely manipulate untrusted code and create PRs.
- **Steps:**
  1. Build a custom Docker image containing Node.js/TypeScript environments.
  2. Have the sandbox securely receive a GitHub App installation token.
  3. Inside the sandbox, clone a test repo, run a hardcoded text-replace script, run `npm test`, and push a Pull Request.
  4. Implement security boundaries: drop network access after clone (except for LLM/GitHub APIs), limit memory/CPU.

### Phase 3: AI Refactoring Integration (LangChain.js)
- **Goal:** Replace the hardcoded script with the LLM pipeline.
- **Steps:**
  1. Integrate LangChain.js into the sandbox environment.
  2. Implement the prompt chain: detect breaking change -> analyze AST -> generate refactored code.
  3. Implement the self-correction loop: if tests fail, feed the `stderr` back to LangChain up to N times.
  4. Handle LLM rate limit exceptions and hook them back into the BullMQ retry logic.

### Phase 4: Production Polish
- **Goal:** Scale and monitor.
- **Steps:**
  1. Add Datadog/Prometheus metrics for queue depth, sandbox creation time, and LLM token usage.
  2. Deploy workers as an auto-scaling group (e.g., ECS/EKS).
  3. Implement user dashboards for viewing `ExecutionLogs`.

## Self-Maintaining API (Phases 5 to 10)

Phases 1 to 4 migrate code when a dependency ships a breaking release.
Phases 5 to 10 migrate code when an external API ships a breaking change, starting with Anthropic and OpenAI.
The design is in [[05 - Self-Maintaining API]], and the workflow is sketched in [[Self-Maintaining API Workflow.excalidraw]].

### Phase 5: API Usage Registry & Repository Scanning
- **Goal:** Know which connected repositories call the Anthropic or OpenAI API, from which files, and with which parameters and models.
- **Steps:**
  1. Add the registry tables to PostgreSQL: `ApiProvider`, `RepositoryScan`, and `ApiUsage`.
  2. Extend the Babel analysis to follow `@anthropic-ai/sdk` and `openai` clients to their method calls, and map each call to an API operation (for example `client.messages.create` to `POST /v1/messages`).
  3. Record the keys of literal request objects and literal model IDs, and mark values read from configuration as dynamic.
  4. Detect raw `fetch` and `axios` calls to `api.anthropic.com` and `api.openai.com`.
  5. Add a `scan` sandbox phase after `prepare`, with no token and no network, since it only parses files.
  6. Trigger a scan on installation, on a push to the default branch, and from `POST /repositories/:id/scan`.
- **Done when:** scanning the SyncLab repository records its Anthropic usage in `server/sandbox/src/llm/` as `POST /v1/messages` with its request parameters, and ignores the provider names that only appear in strings and docs.

### Phase 6: API Change Monitoring & Breaking Change Detection
- **Goal:** Turn provider announcements and spec changes into structured breaking-change records.
- **Steps:**
  1. Add a BullMQ job scheduler that polls each provider's sources every few hours.
  2. Store each fetched source as an `ApiSourceSnapshot` with a content hash, and process only a changed hash.
  3. Diff OpenAI's `openapi.yaml` between snapshots with breaking-change rules (removed endpoints and parameters, new required parameters, removed enum values).
  4. Parse both providers' model deprecation tables into `model_retired` records with their dates.
  5. Classify release notes and SDK changelogs with an LLM using structured output, and drop any result whose evidence quote is not verbatim in the snapshot.
  6. Auto-confirm spec-diff and deprecation-table changes; leave classifier results as `detected` until confirmed from the API or the dashboard.
  7. Test against recorded snapshots so CI never calls a provider.
- **Done when:** replaying two recorded snapshots of a real past change, such as a model retirement, produces exactly the expected `BreakingChange` records.

### Phase 7: Impact Analysis
- **Goal:** For any breaking change, name the repositories and files it breaks.
- **Steps:**
  1. Match each confirmed change to usages on provider, operation, and the changed parameter or model ID.
  2. Write an `ApiImpact` per change and repository, `confirmed` for literal matches and `possible` for dynamic values.
  3. Recompute impact on a new scan or a newly confirmed change, idempotently.
  4. Order work by the change's effective date, so a retirement is migrated before it lands.
  5. Expose `GET /api-changes` and `GET /api-changes/:id/impact`; report `behavior_changed` items without migrating them.
- **Done when:** a seeded change against fixture repositories matches every expected file and none of the files that only mention the API in text.

### Phase 8: API Change Migrations
- **Goal:** Reuse SyncLab's refactor, sandbox test, retry, and pull request automation to fix impacted code.
- **Steps:**
  1. Generalize `MigrationJob` with a `kind` (`dependency` or `api_change`), a nullable `apiImpactId`, and nullable dependency fields, unique per repository and breaking change.
  2. Build a migration brief from the change (kind, before and after, evidence quote, source URL) to replace package release notes in the prompt.
  3. Target the files from the impact record instead of the dependency's imports.
  4. Skip `upgrade` unless the change needs a newer SDK, and then reuse the existing upgrade step.
  5. Run the existing `refactor` and `test` loop with the configured `LLM_PROVIDER`, then `publish` on branch `synclab/api-<provider>-<change>` with the source and deadline in the pull request body.
  6. Add benchmark cases for both SDKs: a retired model, a removed parameter, and a replaced endpoint.
- **Done when:** the benchmark runner passes the new API-change cases end to end.

### Phase 9: Auto-Validation
- **Goal:** Prove a migration fixed the API usage, not just that the tests still pass.
- **Steps:**
  1. Keep the baseline run and the repository's own test suite as the first gate.
  2. Re-scan the migrated tree: the impacted usage must be gone, and nothing retired or removed may be newly used.
  3. Check literal OpenAI request objects against the request schema of the new spec.
  4. Typecheck TypeScript repositories against the SDK version the change requires.
  5. Feed a failed check back into the retry loop with its reason.
  6. Keep live provider calls out of validation, since they would run repository code with a network and a key.
- **Done when:** a benchmark case whose tests pass but which still sends a retired model ID is rejected and retried.

### Phase 10: Dashboard & Dogfooding
- **Goal:** Make the loop visible, and let SyncLab maintain its own API usage.
- **Steps:**
  1. Add dashboard pages for providers and their latest snapshots, a breaking-change feed with confirm and dismiss, and per-repository API usage and impact.
  2. Connect the SyncLab repository itself, so a provider change to the Anthropic API it calls produces a migration pull request on SyncLab.
  3. Extend the Phase 4 metrics with changes detected, repositories impacted, and time from detection to pull request.
- **Done when:** SyncLab opens a pull request on its own repository for a replayed provider change.
