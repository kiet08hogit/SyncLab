# 00 - Architecture Overview

This document provides a high-level overview of the Autonomous API Migration Agent, detailing how the components interact and the lifecycle of a webhook event.

## High-Level Component Diagram

```mermaid
graph TD
    GH[GitHub Webhook] -->|Release Event| Gateway[NestJS Gateway]
    Gateway -->|Enqueues Job| Redis[(Redis / BullMQ)]
    Gateway -->|Checks Status| DB[(PostgreSQL)]
    
    Worker[NestJS Worker Node] -->|Dequeues Job| Redis
    Worker <-->|Reads/Updates State| DB
    
    Worker -->|Spawns via Docker API| Sandbox[Docker Execution Sandbox]
    
    subgraph Sandbox Environment
        Sandbox -->|Clones Code| GitRepo[User Repository]
        Sandbox <-->|Refactors via Prompts| LLM[LangChain.js / LLM]
        Sandbox -->|Runs| Tests[Test Suite]
    end
    
    Sandbox -->|Opens PR| GH
```

## Data Flow Sequence

Here is the step-by-step lifecycle of a webhook event, from API ingestion to the final Pull Request.

```mermaid
sequenceDiagram
    participant GitHub as GitHub Webhook
    participant Gateway as NestJS Gateway
    participant Redis as Redis (BullMQ)
    participant Worker as Async Worker Node (NestJS)
    participant DB as PostgreSQL
    participant Docker as Ephemeral Docker Sandbox
    participant LLM as LLM API (LangChain.js)

    GitHub->>Gateway: POST /webhook (Release Event)
    Gateway->>Gateway: Validate Signature & Payload
    Gateway->>DB: Check for duplicate job/PR
    Gateway->>Redis: Enqueue MigrationJob (BullMQ)
    Gateway-->>GitHub: 202 Accepted
    
    Redis->>Worker: Dequeue Job
    Worker->>DB: Update Status (IN_PROGRESS)
    
    Worker->>Docker: Spawn Ephemeral Container
    activate Docker
    Docker->>Docker: Clone User Repository (Untrusted)
    Docker->>LLM: Analyze breaking changes
    LLM-->>Docker: Suggested Refactors
    Docker->>Docker: Apply AI Refactoring
    Docker->>Docker: Run Test Suite
    
    alt Tests Pass
        Docker->>Docker: Commit changes
        Docker->>GitHub: Create Pull Request
        Docker-->>Worker: Success (PR URL)
        Worker->>DB: Update Status (COMPLETED, PR Created)
    else Tests Fail / Rate Limit Hit
        Docker-->>Worker: Failure (Logs/Error)
        Worker->>DB: Update Status (FAILED / RETRY)
        Worker->>Redis: Retry Job (Exponential Backoff)
    end
    deactivate Docker
    
    Worker->>Docker: Teardown Container
```
