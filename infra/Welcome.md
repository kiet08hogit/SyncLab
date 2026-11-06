# SyncLab architecture

Start with [[00 - Architecture Overview]] for the dependency and external API migration paths.

- [[01 - Core Components]] explains the gateway, scanner, monitor, impact analysis, workers, sandbox, and dashboard.
- [[02 - Database & Queue]] describes durable state, queueing, retries, and deduplication.
- [[03 - Security & Isolation]] records which sandbox phases can use the network and credentials.
- [[04 - Phased Rollout]] tracks what is built and what remains.
- [[05 - Self-Maintaining API]] details provider monitoring, repository scanning, impact matching, migration, and validation.

SyncLab can migrate confirmed API changes in connected repositories.
Phase 10's progress is in [[04 - Phased Rollout]].
