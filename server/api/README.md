# SyncLab API

NestJS service containing both the Gateway (receives GitHub webhooks, enqueues jobs) and the Worker (consumes jobs, orchestrates sandbox containers). See `infra/Architecture/` for the design documents.

## How a job runs

The worker never executes untrusted code itself. It runs a sequence of containers over a single shared Docker volume mounted at `/workspace`:

| Phase | Network | GitHub token | Model key | Does |
| --- | --- | --- | --- | --- |
| `prepare` | yes | yes | no | clone the repository, fetch the target release notes, report the cloned commit |
| `install` | yes | **no** | no | install dependencies with npm, pnpm or yarn, lifecycle scripts included |
| `test` (baseline) | **no** | **no** | **no** | run the test suite on the current version; the job stops if it already fails |
| `upgrade` | yes | **no** | no | upgrade the migrated dependency to the target version |
| `refactor` | yes | no | yes | find files importing the dependency, rewrite them with the configured model (Ollama, Gemini or Claude) |
| `test` | **no** | **no** | **no** | run the package manager's `test` script |
| `publish` | yes | yes | no | clone afresh at the prepared commit, copy the changes across, commit, push the branch, open a pull request |

Repository code runs in `install`, `upgrade` and `test`, and none of them ever receives a credential. `test` also has no network. Only `prepare` and `publish` hold the token, and they run nothing but SyncLab's own code; `publish` never runs git in the checkout on the volume, because repository code could have planted a hook or config there.

After `upgrade`, the worker alternates `refactor` and `test` until the repository's own suite accepts the change, up to `LLM_MAX_ATTEMPTS` times. Each failing test run is left on the volume so the next refactor attempt can read the failure and correct itself. Only when the tests pass does `publish` run. If the refactor changed no files, there is nothing to publish and the job is marked failed with `refactor produced no changes`.

A rate-limited model call, an overloaded Anthropic API (529), or an Ollama server that refuses the connection, fails the job in a way BullMQ retries with backoff. Every other failure, including tests that still fail after the last attempt, is marked unrecoverable so a doomed migration does not spend the quota three times over.

## Setup

```bash
# from server/
docker compose up -d          # Postgres + Redis

# from server/api/
cp .env.example .env          # then fill in the values below
npm install
npx prisma migrate deploy     # or `npx prisma migrate dev` while iterating
npm run sandbox:build         # builds synclab-sandbox:latest from ../sandbox
npm run start:dev             # gateway + worker in one process
```

To process more than one job at a time, leave the gateway as a single process and start extra workers. Each worker process takes jobs from the same Redis queue. `WORKER_CONCURRENCY` (default `1`) is how many sandboxes one process runs at once -- keep it at 1 unless the machine can hold more than one 2GB container.

```bash
npm run start:gateway         # terminal 1
npm run start:worker          # terminal 2
npm run start:worker          # terminal 3, optional
```

If your database already has these tables because it was created with `prisma db push`, baseline it instead of applying the first migration:

```bash
npx prisma migrate resolve --applied 20260803000000_init
```

If `npm run sandbox:build` cannot reach Docker, set `DOCKER_SOCKET_PATH` in `.env`. Docker Desktop on macOS usually places the socket at `~/.docker/run/docker.sock`, while dockerode looks at `/var/run/docker.sock` by default.

## Credentials

`GITHUB_WEBHOOK_SECRET` is always required. The gateway verifies the `x-hub-signature-256` header against it and rejects anything that does not match.

The `/migrations` and `/repositories` routes take a bearer token in `Authorization: Bearer <token>`, and know who is calling from it:

- A **GitHub App user access token** (what the dashboard sends after GitHub sign-in) identifies a user.
  The gateway asks GitHub which installations and repositories that user can reach (`GET /user/installations` and each installation's repositories), and every route only reads or writes jobs on those repositories, matched by GitHub's repository id.
  A job or repository outside them answers `404`, the same as one that does not exist.
  The answer is cached for 60 seconds per token, so a page load costs one round of GitHub calls.
- **`MIGRATIONS_API_TOKEN`** is a service credential for scripts and automation, and may act on any repository.
  Leave it empty to accept user tokens only.

Anything else, including a personal access token or a revoked user token, answers `401`.
If GitHub rate-limits the access check, the route answers `503` instead, since the token is still valid.

`LLM_PROVIDER` picks the model provider for the refactor phase: `ollama` (the default), `gemini` or `anthropic`.

With `ollama`, no key is needed. Install and start Ollama on the host and pull the model:

```bash
brew install ollama
brew services start ollama
ollama pull qwen2.5-coder:14b
```

The refactor container reaches it at `LLM_BASE_URL`, which defaults to `http://host.docker.internal:11434`.

With `gemini`, `GEMINI_API_KEY` is required. Create one in [Google AI Studio](https://aistudio.google.com/apikey). It is passed only to the `refactor` container and never to the phase that runs repository code.

With `anthropic`, `ANTHROPIC_API_KEY` is required. Create one in the [Claude Console](https://platform.claude.com/settings/keys). It is handled the same way as the Gemini key. The model defaults to `claude-opus-5-5`.

For repository access, either register a GitHub App (preferred) or use a Personal Access Token for local experiments.

### Registering the GitHub App

`npm run github-app:register` registers the App through GitHub's [App Manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest) and writes its credentials for you:

```bash
npx smee-client --url https://smee.io/new   # or any public URL that reaches the gateway; note the channel URL it prints
npm run github-app:register -- --webhook-url https://smee.io/<channel> --name "SyncLab <your-handle>"
```

1. Open `http://localhost:3002` and press **Continue to GitHub**.
   GitHub shows the App with its settings filled in: **Contents** and **Pull requests** read and write, **Metadata** read, the **Pull request** and **Push** events, the webhook URL, and the dashboard's sign-in callback `http://localhost:3001/auth/github/callback`.
2. Press **Create GitHub App**.
   GitHub redirects back with a one-time code, which the script exchanges for the App's credentials.
   It writes `GITHUB_APP_ID`, `GITHUB_WEBHOOK_SECRET` and `GITHUB_PRIVATE_KEY_PATH` to `.env`, the private key next to it as `<slug>.private-key.pem` (gitignored), and `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_SLUG` and a `SESSION_SECRET` to `web/.env.local`.
   Nothing secret is printed.
3. Follow the install link on the final page, and install the App on the repositories SyncLab should migrate.

App names are unique across GitHub, so pick one with your handle in it.
The script registers the App under your personal account; to register it under an organization, use the manual steps below.

GitHub cannot reach `localhost`, so for local development keep `npx smee-client --url https://smee.io/<channel> --target http://localhost:3000/webhook` running; it relays each delivery to the gateway.

To register by hand instead, create the App under Settings, Developer settings, GitHub Apps with the permissions, event, webhook and callback URLs above, generate a private key and a client secret, and set the same variables.

The worker mints a fresh installation token per job. The private key stays in the worker and is never passed into a sandbox container.

### Personal Access Token fallback

Set `GITHUB_TOKEN` to a token with `repo` scope and leave the App variables unset. This exists so the sandbox can be exercised end to end before an App is registered; it should not be used against repositories you do not own.

## Automatic trigger: Dependabot and Renovate pull requests

Dependabot and Renovate already watch npm for every repository they run on, and open a pull request for each new version.
The gateway listens for those pull requests on `/webhook` and starts a migration when one is opened or reopened:

| Bot | Title it reads | Also required |
| --- | --- | --- |
| `dependabot[bot]` | `Bump lodash from 4.17.20 to 4.17.21`, with or without a `build(deps):` style prefix | a `dependabot/npm_and_yarn/` branch |
| `renovate[bot]` | `Update dependency lodash to v4.17.21`, with or without a prefix and a ` [security]` or ` (major)` suffix | an npm diff link for that dependency in the PR body (`renovatebot.com/diffs/npm/lodash/...`, scoped names may be URL-encoded); for a shortened `to v5`, the exact version from the change table row that carries that link |

It ignores, with a reason in the `202` response, every pull request it cannot act on safely: other authors (the author must be the bot account, of type `Bot`), branches from forks, other ecosystems, grouped updates (`Bump the npm_and_yarn group ...`, `Update react monorepo ...`), and updates in a subdirectory (`... in /packages/web`), because the worker only upgrades the root `package.json`.
Renovate titles name neither the package manager nor the directory, so before queueing a job for either bot the gateway reads the repository's root `package.json` with the installation token.
If the dependency is not in its `dependencies`, `devDependencies`, `optionalDependencies` or `peerDependencies`, or there is no root `package.json`, the pull request is ignored with a reason.
The gateway therefore needs GitHub credentials (the App, or `GITHUB_TOKEN` locally) to accept a webhook.
SyncLab opens its own pull request on `synclab/<dependency>-<version>`; it does not push to the bot's branch.

### Testing the webhook locally

The gateway requires a valid signature, so the payload has to be signed:

```bash
SECRET="your-webhook-secret"
BODY=$(cat payload.json)
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"

curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: pull_request" \
  -H "X-Hub-Signature-256: $SIG" \
  --data "$BODY"
```

The payload needs `action: "opened"`, a `pull_request` with `title`, `user.login`, `user.type`, `head.ref` and `head.repo.full_name` (plus a `body` with the npm diff link for Renovate), a `repository` with `id` and `full_name`, and an `installation.id`.

## Triggering a migration manually

`POST /migrations` queues a job without waiting for a bot pull request:

```bash
curl -X POST http://localhost:3000/migrations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MIGRATIONS_API_TOKEN" \
  --data '{"repoFullName":"owner/repo","dependencyName":"axios","targetVersion":"1.7.0"}'
```

The gateway looks the repository up on GitHub (404 if it does not exist, the App cannot see it, or a user caller cannot reach it), then creates the job or returns the existing one for the same repository, dependency and version. Like the webhook, it only queues an existing job again if its status is `FAILED`. The response is `202` with the job `id`, its `status`, and whether it was `queued`.

## Reading jobs and repositories

Every read is limited to the caller's repositories (see [Credentials](#credentials)).
`githubRepoId` and `installationId` come back as strings, because JSON cannot carry a BigInt.

| Route | Returns |
| --- | --- |
| `GET /migrations` | Jobs, newest first, each with its repository and `steps` (the log steps reached so far). Filters: `status`, `repo` (`owner/name`), `q` (case-insensitive match on dependency, version or repository), and `limit` (default 100, at most 500). |
| `GET /migrations/counts` | The number of jobs per status, including statuses with none. |
| `GET /migrations/:id` | One job with its repository and execution log, oldest entry first. `404` for an unknown or inaccessible job, `400` when the id is not a UUID. |
| `GET /repositories` | For a user, every repository their installations reach, including ones with no jobs yet; for the service token, every repository SyncLab has recorded. Each has `jobCount`, `completed`, `failed`, `active` and `lastActivityAt`. |
| `GET /repositories/:githubRepoId/api-usage` | The repository's Anthropic and OpenAI API calls from its newest completed scan (`usageScan`), with the newest scan of any status next to it (`latestScan`). Each usage has its `provider`, `file`, `line`, `style` (`sdk` or `http`), SDK `method`, `operation` (such as `POST /v1/messages`, or `null` when unknown), request `params`, literal `modelIds`, and `dynamic` when part of the request is only known at runtime. `404` for an inaccessible or never-scanned repository. |
| `GET /api-providers` | Every watched provider with its sources (`kind`, `url`, `lastCheckedAt`, `lastError`, `latestSnapshot`) and its change counts per status. Not limited by repository. |
| `GET /api-changes` | Breaking changes the monitor read from the providers, newest first. Filters: `provider` (`anthropic`, `openai`), `status` (`detected`, `confirmed`, `dismissed`) and `kind`. Each change has its `field` or `operation`, `replacement`, `effectiveAt` date, the `section` and verbatim `evidence` it was read from, and its `source`. |
| `POST /api-changes/:id/confirm`, `POST /api-changes/:id/dismiss` | Set a change's status to `confirmed` or `dismissed` and return it in the `GET /api-changes` shape. |

## Scanning repositories for API usage

The worker keeps a registry of every call each repository makes to the Anthropic or OpenAI API, for the self-maintaining API phases in `infra/Architecture/05 - Self-Maintaining API.md`.
A scan runs two sandbox containers on one volume: `clone` makes a shallow clone of the default branch with the GitHub token, then `scan` parses it with no token and no network.

Scans start on their own when the App is installed or a repository is added to an installation, and on every push to the default branch.
Apps registered before the push event was added need it switched on under the App's **Permissions & events** settings.
A repository has at most one scan waiting to start, so a burst of pushes is scanned once.
A failed scan is not retried; the next push, or a manual trigger, scans again.
Only the newest completed scan of a repository keeps its usages; older scans stay listed as history without them.

```bash
curl -X POST http://localhost:3000/repositories/<githubRepoId>/scan \
  -H "Authorization: Bearer $MIGRATIONS_API_TOKEN"
```

The response is `202` with the scan `id`, its `status`, and whether it was `queued` (false when it joined a scan already waiting).
Like `POST /migrations`, a user may only scan repositories their installations reach, and the service token may only scan repositories SyncLab has recorded.

## Monitoring API changes

The worker watches what Anthropic and OpenAI publish about their APIs, for the self-maintaining API phases in `infra/Architecture/05 - Self-Maintaining API.md`.
Every `API_MONITOR_INTERVAL_MS` (default 6 hours) it fetches each source, reduces it to the part its reader parses, and stores a snapshot only when that changed, so page markup that changes on every request does not count.
Each source is requested in exactly the format its reader parses (HTML for the docs pages), because the docs sites answer a request that also accepts markdown with markdown.

| Source | Reader | Status of what it finds |
| --- | --- | --- |
| Model deprecations pages (both providers) | retirement tables: a model retirement names the model, an endpoint retirement its path | `confirmed` |
| OpenAI's OpenAPI spec | the request surface (operations, parameters, required flags, enum values) diffed against the previous snapshot: removed endpoints and parameters, newly required parameters, removed enum values | `confirmed` |
| API release notes and TypeScript SDK changelogs (both providers) | the lines added since the previous snapshot, classified by the configured model in the `classify` sandbox phase | `detected` |

The tables and the spec are the providers' own statements, so what they show is confirmed directly.
What a model reads from prose stays `detected` until someone confirms it, and a classified change is kept only if its evidence is a verbatim quote of the snapshot, so a model cannot invent a breaking change.
The spec, release notes and changelogs compare against their previous snapshot, so a source's first snapshot is a baseline and history is not reported as new; a page where most lines change at once is stored as a new baseline without classifying it.
Classifying needs `LLM_PROVIDER` `gemini` or `anthropic`; if the model cannot be reached the snapshot is not stored, so the next poll classifies the same lines again.
Reading the same change again updates its date or replacement, keeps a dismissed change dismissed, and never lets a classified change rewrite one from a table or the spec; a change that later disappears from its source is kept.
A source that fails to load, or no longer has what its reader expects, is recorded as its `lastError` instead of being read as "nothing changed".
Set `API_MONITOR_ENABLED=false` to stop the schedule.

```bash
curl -X POST http://localhost:3000/api-providers/poll \
  -H "Authorization: Bearer $MIGRATIONS_API_TOKEN"
```

This polls every source now and answers `202 {"queued": true}`; a poll that is already waiting or running absorbs repeated requests.

`POST /api-changes/:id/confirm` and `POST /api-changes/:id/dismiss` set a change's status and return it in the `GET /api-changes` shape (`404` for an unknown change, `400` for an id that is not a UUID).
Confirming and dismissing are idempotent, and a dismissed change can be confirmed again.
The response shapes are documented in `infra/Architecture/05 - Self-Maintaining API.md` under "Monitoring endpoints".

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run start:dev` | run the gateway and worker in one process |
| `npm run start:gateway` | webhooks and `POST /migrations` only (`APP_ROLE=gateway`) |
| `npm run start:worker` | sandbox jobs only (`APP_ROLE=worker`) |
| `npm run sandbox:build` | build the sandbox container image |
| `npm run db:generate` | generate the Prisma client |
| `npm run typecheck` | type-check without emitting |
| `npm run lint` | lint and auto-fix |
| `npm run lint:check` | lint without fixing, as CI runs it |
| `npm test` | unit tests |
| `npm run test:e2e` | end-to-end tests (no Postgres or Redis needed) |

The sandbox agent has its own suite. Run `npm test` from `server/sandbox` to exercise every phase except `refactor` and their helpers against local git repositories and a stub npm registry.
