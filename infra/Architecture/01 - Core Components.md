# 01 - Core Components

This document outlines the detailed responsibilities for the core services making up the Autonomous API Migration Agent.

## A. NestJS Gateway (Ingestion Layer)
The Gateway acts as the public entry point for incoming GitHub events.
- **Responsibilities:** 
  - Expose a secure public endpoint to receive GitHub webhooks.
  - Validate GitHub cryptographic signatures to prevent spoofed payloads.
  - Parse the webhook event (e.g., third-party library release).
  - Perform a quick lookup in PostgreSQL to verify if the repository is subscribed and if a migration for this specific version has already been initiated.
  - Push a normalized task payload onto the Redis/BullMQ queue.

## B. Async Worker Nodes (Orchestration Layer - NestJS)
The Worker node sits behind the scenes processing the queued jobs.
- **Responsibilities:** 
  - Consume messages from BullMQ.
  - Act as the state coordinator: Update the PostgreSQL database throughout the lifecycle of a job (queued, started, completed, failed).
  - Manage the programmatic spawning and teardown of Ephemeral Docker Sandboxes using the Docker Engine API.
  - Monitor sandbox execution timeouts and collect logs for the database.
  - **Security Isolation:** The worker node itself never executes the untrusted code. It strictly orchestrates Docker.

## C. Docker Execution Sandbox (Execution Layer)
The Sandbox is an ephemeral environment where untrusted code is manipulated.
- **Responsibilities:** 
  - Run as an ephemeral, unprivileged container with no access to the host file system.
  - Authenticate and clone the user's repository via a short-lived GitHub token.
  - Execute the LangChain.js AI refactoring loop: parse code, send snippets to the LLM, and apply the AST/string changes.
  - Execute the user's test suite safely. If tests fail, potentially feed the error back into the LLM for a self-correction loop.
  - Push the branch and open a PR via the GitHub API if tests pass.
