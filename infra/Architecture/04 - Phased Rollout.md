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
