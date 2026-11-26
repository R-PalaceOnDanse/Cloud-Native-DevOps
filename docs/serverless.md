# Serverless stack

What `infra/serverless` deploys, how a request reaches a function, and how to test it. Read by
anyone who adds a function or a route. The choices are in
[ADR-0005](adr/0005-typescript-for-functions.md) (TypeScript) and
[ADR-0006](adr/0006-api-gateway-cloud-run-functions-pubsub.md) (API Gateway, Cloud Run functions,
Pub/Sub).

## What exists (C05)

```
client --HTTPS + x-api-key--> API Gateway (canvas-gw) --ID token of api-gateway SA--> function hello --> Secret Manager (hello-greeting)
```

| Resource | Name | Role |
|---|---|---|
| API Gateway | `canvas-api` / `canvas-gw` | The only public entry point. Refuses a request without a valid API key (401) or validates OAuth / draw routes. |
| Cloud Run function | `hello` (Node.js 22, TypeScript) | Returns proof that it read its secret; never returns the value. |
| Cloud Run function | `web-draw-proxy` (Node.js 22, TypeScript) | Validates pixel draw batches and publishes event envelopes to Pub/Sub (#76). |
| Cloud Run function | `auth-callback` (Node.js 22, TypeScript) | Exchanges Discord OAuth2 code, discards access token, and mints session token (#79). |
| Cloud Run function | `draw-worker` (Node.js 22, TypeScript) | Consumes Pub/Sub messages, updates Firestore chunks, enforces rate limits, handles admin commands and snapshots (#141, #147). |
| Service account | `fn-hello` | Runtime identity of `hello`: writes logs, reads `hello-greeting`. Nothing else. |
| Service account | `fn-web-draw-proxy` | Runtime identity of `web-draw-proxy`: publishes to `pixel-draw-events`. |
| Service account | `fn-auth-callback` | Runtime identity of `auth-callback`: reads Discord OAuth secrets from Secret Manager. |
| Service account | `fn-draw-worker` | Runtime identity of `draw-worker`: reads Pub/Sub messages, writes Firestore chunks, accesses snapshot bucket (#136). |
| Service account | `api-gateway` | Identity of the gateway. The only principal with `run.invoker` on protected functions. |
| Service account | `fn-build` | Builds the sources with Cloud Build, instead of the default compute account. Roles: log writer, Artifact Registry writer, Storage object viewer. |
| Secret | `hello-greeting` | Created by Terraform, **value added by hand** (below). |
| Bucket | `<project>-fn-sources` | Private bucket of the zipped sources. |
| Bucket | `<project>-canvas-snapshots` | Private bucket for timestamped canvas snapshots, accessed strictly via signed URLs (#135). |
| Pub/Sub Topic | `pixel-draw-events` | Message broker topic for asynchronous pixel draws and commands (#137). |
| Pub/Sub Subscription | `draw-worker-sub` | Push subscription invoking `draw-worker` with exponential retry backoff and DLQ (#137). |
| API key | `canvas-demo` | Restricted to `canvas-api`. Read with `terraform output -raw demo_api_key`. |

Every identity is explicit: the function runtime, the build and the gateway each name their own
account in the code, and nothing uses the default compute account (which has Editor on the
project). A new function gets its own account and its own secret binding, as `hello` does.

The function's ingress is `ALLOW_ALL` because API Gateway does not run in the VPC; it is protected
by IAM: a call that does not carry an ID token of the `api-gateway` account gets 403.
In addition, the Google-managed API Gateway Service Agent (`service-<PROJECT_NUMBER>@gcp-sa-apigateway.iam.gserviceaccount.com`)
holds `roles/iam.serviceAccountTokenCreator` on `api-gateway` ([Issue #132](https://github.com/R-PalaceOnDanse/Cloud-Native-DevOps/issues/132)),
and the OpenAPI template explicitly declares `jwt_audience: ${service_url}` under each backend path
([Issue #133](https://github.com/R-PalaceOnDanse/Cloud-Native-DevOps/issues/133)) to ensure exact OIDC audience match and prevent HTTP 401 token rejections.

## Add the secret value (once per environment)

Terraform creates the secret but not its value, so the value is in neither the repository nor the
state (rules in [infra.md](infra.md#secrets)). After the first apply of the stack in an
environment:

```bash
printf 'any demo value' | gcloud secrets versions add hello-greeting \
  --project=teampasx-cloudnative-dev --data-file=-
```

Until then, `/hello` answers 500 `secret unavailable`. A destroy of the stack deletes the secret and
its value.

## Test it

```bash
terraform -chdir=infra/serverless init -reconfigure -backend-config=backends/dev.hcl
GW=$(terraform -chdir=infra/serverless output -raw gateway_url)
KEY=$(terraform -chdir=infra/serverless output -raw demo_api_key)
FN=$(terraform -chdir=infra/serverless output -raw hello_function_url)

curl -i "$GW/hello"                                     # 401: no key
curl -i -H "x-api-key: $KEY" "$GW/hello"                # 200: secret_read true
curl -i "$FN"                                           # 403: the function is not public
curl -i -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$FN"  # 403: only the gateway may invoke
```

## Work on a function

```bash
cd app/functions/hello
npm ci
npm run build
npx functions-framework --target=hello   # local run on :8080, without the secret: 500 expected
```

Cloud Build runs `gcp-build` (which compiles TypeScript) at deployment; `dist/` and
`node_modules/` are never committed. Changing the source changes the hash in the uploaded object's
name, which redeploys the function on the next release.

## Logs

Every line is one JSON object (`app/functions/hello/src/log.ts`): `severity`, `message`, `function`,
`correlation_id`, and when there is one `path`, `error` and `logging.googleapis.com/trace`, which
links the line to its trace in Cloud Trace. These are the only fields a line can carry: the logger
drops anything else, so a token, a header or a request body cannot reach Cloud Logging. The tests
in `log.test.ts` check it and run in `functions-ci`.

To read everything one request did, open Logs Explorer in the project and run this query with the
`correlation_id` that the response returns in its body and in the `x-correlation-id` header:

```text
resource.type="cloud_run_revision"
jsonPayload.correlation_id="THE-CORRELATION-ID"
```

Add `severity>=ERROR` to keep only the failures. Save the query in Logs Explorer to reuse it. The
same field will be carried by the proxy and the workers, so one query will follow a request through
all of them.

## Deployment

The stack is planned on every pull request and applied by a release tag after `foundation`, dev
then prd ([ci.md](ci.md)). The destroy workflow destroys it before `foundation`. The pipeline's
apply account needs `roles/run.admin` and `roles/secretmanager.admin` in addition to Editor, and
the plan account `roles/serviceusage.apiKeysViewer`; both are granted by the `access` stack.

## The application pipeline (C06 & C07)

| Component | Role | Identity and access |
|---|---|---|
| `discord-proxy` | `/discord/interactions`: checks the Ed25519 signature, answers PING; for a slash command publishes `pixel.draw` (/draw) or `discord.command` (the others) and answers a deferred response (type 5), which the worker edits | `fn-discord-proxy`, reads `discord-public-key`, publisher on `pixel-draw-events` only |
| `web-draw-proxy` | `/draw`: validates a pixel batch, publishes `pixel.draw` | `fn-web-draw-proxy`, publisher on `pixel-draw-events` only |
| `auth-callback` | `/auth/discord/callback`: Discord OAuth2 code exchange, mints a Firebase custom token for `discord:<id>` | `fn-auth-callback`, reads `discord-client-secret`, signs with its own identity |
| `pixel-draw-events` | Topic; push subscription to the worker with an OIDC token of `pubsub-push`, 5 attempts then `pixel-draw-events-dlq` (kept 7 days in `pixel-draw-events-dlq-inspection`) | |
| `draw-worker` | Draws, `/get`, `/snapshot`, `/admin *`. Ingress internal only: only the Pub/Sub push reaches it | `fn-draw-worker`: Firestore, snapshot bucket, signs its own URLs |

Data in Firestore (the frontend listens to `chunks/*` and `config/system`; clients can read, never write):

- `chunks/chunk_X_Y`: 64×64 tile, `pixels["lx,ly"] = {color, author, timestamp}`. Each tile is written
  in one transaction that also reads the epoch: concurrent writes retry instead of losing a pixel,
  a redelivered event is skipped (`processedEvents`), and a write racing `/admin clear` cannot bring
  old pixels back.
- `config/system`: `paused`, `epoch`, `lastClearedAt`, `admins` (extra admin Discord IDs).
- `ratelimits/{discordId}`: token bucket, 20 pixels per minute, `overrideLimit` set by `/admin ratelimit`.

Web login (ADR-0009): Discord OAuth2 → `auth-callback` → custom token → the browser signs in to
Firebase → its ID token is checked by the Firestore rules, and by **API Gateway** on `/draw`, which
then forwards the verified identity to the function (`X-Apigateway-Api-Userinfo`). Nothing else can
call the function, so the identity cannot be forged.

## Configure an environment for the application (once per environment)

1. Discord developer portal, the application of the environment:
   - OAuth2 → Redirects: add the `frontend_origin` output (by default `https://<project>.web.app`).
   - General → Interactions endpoint URL: `<gateway_url>/discord/interactions`.
2. `infra/serverless/<env>.tfvars`: `discord_client_id` (the application ID, public) and
   `admin_user_ids` (Discord IDs of the admins), then a release.
3. Secret values, never in Terraform:
   ```bash
   printf '%s' "<client secret>" | gcloud secrets versions add discord-client-secret --data-file=- --project=<project>
   printf '%s' "<public key>"    | gcloud secrets versions add discord-public-key   --data-file=- --project=<project>
   ```
4. Build the frontend with `terraform output -json frontend_build_env` as its `VITE_*` variables (#168).

Check: `curl -X POST <gateway_url>/draw` answers 401 (no Firebase token); the worker URL answers 403
from the internet; `/discord/interactions` with a bad signature answers 401.

## End-to-End Event Pipeline Test (Issue #143)

The automated end-to-end integration test (`app/functions/draw-worker/src/pipeline-e2e.test.ts`) verifies the complete asynchronous flow across proxies, brokers, workers, and storage:

```bash
cd app/functions/draw-worker
npm test
```

Pipeline verification flow:
1. **Web Draw Proxy**: takes the identity verified by the gateway, validates the batch, formats the `EventEnvelope` and publishes to `pixel-draw-events`.
2. **Pub/Sub**: pushes to `draw-worker` with retry backoff, then dead-letters to `pixel-draw-events-dlq`.
3. **Draw Worker**: decodes the envelope, validates bounds (`0..9999`) and colors, applies pause and the per-user rate limit (20/min), writes `chunks/{chunkId}` in a transaction.
4. **Real time**: the frontend listens to the chunk documents it displays; only the changed tile is sent.
5. **Correlation ID**: propagated from the proxy to the worker in the envelope and in every structured log line, with the Cloud Trace ID.

These tests use in-memory stores; the Firestore and Cloud Storage code paths are exercised on dev
after a release (see "Configure an environment" above).

## Discord Slash Commands Registration (Issue #49)

All mandatory bot commands (`/draw`, `/get`, `/snapshot`, `/admin pause`, `/admin resume`, `/admin clear`, `/admin ratelimit`) are registered idempotently using Discord REST API v10 bulk overwrite endpoint (`PUT /applications/{app_id}/commands`).

### Local Execution & Dry-Run

```bash
# Dry-run validation (no secrets required)
node scripts/register-discord-commands.mjs --dry-run

# Unit tests
node --test scripts/register-discord-commands.test.mjs

# Live registration with Discord credentials
node scripts/register-discord-commands.mjs \
  --app-id <DISCORD_APPLICATION_ID> \
  --bot-token <DISCORD_BOT_TOKEN> \
  [--guild-id <GUILD_ID>]
```

### CI/CD Pipeline

The workflow `.github/workflows/register-discord-commands.yml` executes:
1. Automatic validation and unit testing on pull requests targeting `scripts/register-discord-commands.*`.
2. Manual idempotent deployment via `workflow_dispatch` with target environment (`dev` or `prd`) and optional instant guild scoping.

