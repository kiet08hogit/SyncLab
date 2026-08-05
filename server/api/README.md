# SyncLab API

NestJS service containing both the Gateway (receives GitHub webhooks, enqueues jobs) and the Worker (consumes jobs, orchestrates sandbox containers). See `infra/Architecture/` for the design documents.

## How a job runs

The worker never executes untrusted code itself. It runs a sequence of containers over a single shared Docker volume mounted at `/workspace`:

| Phase | Network | GitHub token | Model key | Does |
| --- | --- | --- | --- | --- |
| `prepare` | yes | yes | no | clone the repository, install dependencies, fetch the target release notes |
| `refactor` | yes | no | yes | find files importing the dependency, rewrite them with Gemini |
| `test` | **no** | **no** | **no** | run `npm test` |
| `publish` | yes | yes | no | commit, push the branch, open a pull request |

`test` is the only phase that runs repository code, and it is the one with no network access and no credentials. `refactor` reaches the model provider but only reads and writes files using SyncLab's own code, so nothing from the repository ever executes with a network connection.

After `prepare`, the worker alternates `refactor` and `test` until the repository's own suite accepts the change, up to `LLM_MAX_ATTEMPTS` times. Each failing test run is left on the volume so the next refactor attempt can read the failure and correct itself. Only when the tests pass does `publish` run.

A rate-limited model call fails the job in a way BullMQ retries with backoff. Every other failure, including tests that still fail after the last attempt, is marked unrecoverable so a doomed migration does not spend the quota three times over.

## Setup

```bash
# from server/
docker compose up -d          # Postgres + Redis

# from server/api/
cp .env.example .env          # then fill in the values below
npm install
npx prisma migrate deploy     # or `npx prisma migrate dev` while iterating
npm run sandbox:build         # builds synclab-sandbox:latest from ../sandbox
npm run start:dev
```

If your database already has these tables because it was created with `prisma db push`, baseline it instead of applying the first migration:

```bash
npx prisma migrate resolve --applied 20260803000000_init
```

If `npm run sandbox:build` cannot reach Docker, set `DOCKER_SOCKET_PATH` in `.env`. Docker Desktop on macOS usually places the socket at `~/.docker/run/docker.sock`, while dockerode looks at `/var/run/docker.sock` by default.

## Credentials

`GITHUB_WEBHOOK_SECRET` is always required. The gateway verifies the `x-hub-signature-256` header against it and rejects anything that does not match.

`GEMINI_API_KEY` is required for the refactor phase. Create one in [Google AI Studio](https://aistudio.google.com/apikey). It is passed only to the `refactor` container and never to the phase that runs repository code.

For repository access, either register a GitHub App (preferred) or use a Personal Access Token for local experiments.

### Registering the GitHub App

1. Go to Settings, Developer settings, GitHub Apps, then New GitHub App.
2. Repository permissions: **Contents** read and write, **Pull requests** read and write, **Metadata** read.
3. Subscribe to the **Release** event.
4. Set the webhook URL to your gateway's `/webhook` endpoint and the webhook secret to the same value as `GITHUB_WEBHOOK_SECRET`.
5. Generate a private key and download the `.pem`.
6. Install the App on the repositories you want SyncLab to migrate.
7. Set `GITHUB_APP_ID` and either `GITHUB_PRIVATE_KEY_PATH` or `GITHUB_PRIVATE_KEY` in `.env`.

The worker mints a fresh installation token per job. The private key stays in the worker and is never passed into a sandbox container.

### Personal Access Token fallback

Set `GITHUB_TOKEN` to a token with `repo` scope and leave the App variables unset. This exists so the sandbox can be exercised end to end before an App is registered; it should not be used against repositories you do not own.

## Testing the webhook locally

The gateway requires a valid signature, so the payload has to be signed:

```bash
SECRET="your-webhook-secret"
BODY=$(cat payload.json)
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"

curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: release" \
  -H "X-Hub-Signature-256: $SIG" \
  --data "$BODY"
```

The payload needs `action: "published"`, a `repository` with `id` and `full_name`, a `release.tag_name`, and an `installation.id`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run start:dev` | run the gateway and worker with reload |
| `npm run sandbox:build` | build the sandbox container image |
| `npm test` | unit tests |
| `npm run test:e2e` | end-to-end tests |

The sandbox agent has its own suite. Run `npm test` from `server/sandbox` to exercise the dependency analyzer and the rate-limit classifier.
