# 01 - Core Components

The NestJS application runs a gateway, workers, or both, selected by `APP_ROLE`.
The worker processes scan, API-monitor, and migration queues in Redis through BullMQ.
PostgreSQL holds the durable state; Docker runs every phase that touches a connected repository.

## Gateway

The gateway verifies signed GitHub webhooks.
It accepts Dependabot and Renovate npm update pull requests and authenticated manual migration requests.
It also queues repository scans when an App installation adds a repository, a push reaches its default branch, or an authorized caller requests a scan.
It exposes job, repository, provider, change, and impact endpoints to the dashboard, with repository access limited to the caller's GitHub installations.

## Repository scanner

The scan worker runs `clone` and then `scan` in separate sandbox containers.
`clone` receives a short-lived installation token; `scan` receives no token and no network.
The scanner records supported SDK and raw HTTP calls to Anthropic and OpenAI, including operation, request keys, literal model IDs, and whether values are dynamic.
The latest completed scan supplies the usages used for impact analysis.
See [[05 - Self-Maintaining API#Repository scanning]].

## API monitor and impact analysis

The monitor polls provider deprecation pages, the OpenAI spec, release notes, and SDK changelogs on a schedule or by request.
It stores a new snapshot only when extracted content changes.
Deterministic readers confirm spec removals and model deprecations; a model classifies new prose in a separate `classify` sandbox phase.
Classified prose starts as `detected`, so an admin must confirm it before it can start a migration.
Impact analysis matches confirmed changes to the latest completed usages and queues one API-change job for each new confirmed repository impact.
It keeps possible impacts visible without migrating them.

## Migration worker

The migration worker claims a job in PostgreSQL, obtains a GitHub installation token, and orchestrates the sandbox phases.
It runs `prepare`, a validation baseline, `install`, and a baseline `test` before changing code.
Dependency jobs then run `upgrade`; API-change jobs run it when the job records a required SDK release.
The worker repeats `refactor`, `test`, and `validate` up to the configured attempt limit, then runs `publish` only after the checks pass.
It records phase logs, cleans up the containers and volume, and marks the job `COMPLETED`, `FAILED`, or `QUEUED` for a transient retry.

## Sandbox and dashboard

Each phase is a short-lived non-root container over a named Docker volume.
Only `prepare`, `clone`, and `publish` receive GitHub credentials, and the test and validation phases have no network.
The dashboard shows migration jobs, logs, repository API usage, provider sources, and breaking changes; the API also exposes impacts.
The security boundaries are in [[03 - Security & Isolation]], and the API-change workflow is in [[05 - Self-Maintaining API]].
