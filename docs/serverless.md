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

## Deployment

The stack is planned on every pull request and applied by a release tag after `foundation`, dev
then prd ([ci.md](ci.md)). The destroy workflow destroys it before `foundation`. The pipeline's
apply account needs `roles/run.admin` and `roles/secretmanager.admin` in addition to Editor, and
the plan account `roles/serviceusage.apiKeysViewer`; both are granted by the `access` stack.

## Next (C06 & C07)

The proxy pattern replaces `hello`: a Discord proxy that checks the Ed25519 signature, a Web Draw Proxy that receives browser pixel batches and publishes to Pub/Sub, and an Auth Callback function that exchanges Discord OAuth codes.
Firestore Native NoSQL database and Firestore Security Rules (`infra/serverless/firestore.rules`) are deployed via Terraform (`firestore.tf`, `firestore_rules.tf`) to enforce authenticated client read-only access and reject all direct client writes.
The `draw-worker` function consumes Pub/Sub messages, enforces token bucket rate limits, updates Firestore chunks transactionally with Last-Write-Wins timestamps and epoch precedence, emits real-time delta documents with 5-minute TTL, and updates Discord interactions.

## End-to-End Event Pipeline Test (Issue #143)

The automated end-to-end integration test (`app/functions/draw-worker/src/pipeline-e2e.test.ts`) verifies the complete asynchronous flow across proxies, brokers, workers, and storage:

```bash
cd app/functions/draw-worker
npm test
```

Pipeline verification flow:
1. **Web Draw Proxy**: Accepts batch of pixels, authenticates session token, formats `EventEnvelope`, and publishes to `pixel-draw-events`.
2. **Pub/Sub Broker**: Buffers messages with 7-day retention and dispatches to `draw-worker` push subscription with retry backoff and DLQ (`pixel-draw-events-dlq`).
3. **Draw Worker**: Decodes Base64 envelope, validates bounds (`0..9999`), enforces per-user rate limiting (20 tokens/min), and applies transactional updates to `chunks/{chunkId}`.
4. **Real-time Deltas**: Generates delta documents (`chunks/{chunkId}/deltas/{deltaId}`) with 300s TTL for real-time Firestore listeners.
5. **Correlation ID Tracing**: Verifies `correlation_id` is propagated end-to-end through structured JSON logs and response headers.

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

