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
| Cloud Run function | `snapshot-notifier` (Node.js 22, TypeScript) | Triggered by each new snapshot object: signs a read URL valid 1 hour and edits the Discord answer of `/snapshot` (#169). |
| Service account | `fn-hello` | Runtime identity of `hello`: writes logs, reads `hello-greeting`. Nothing else. |
| Service account | `fn-web-draw-proxy` | Runtime identity of `web-draw-proxy`: publishes to `pixel-draw-events`. |
| Service account | `fn-auth-callback` | Runtime identity of `auth-callback`: reads Discord OAuth secrets from Secret Manager. |
| Service account | `fn-draw-worker` | Runtime identity of `draw-worker`: reads Pub/Sub messages, writes Firestore chunks, creates snapshot objects (`storage.objectCreator`, cannot read or sign them) (#136, #169). |
| Service account | `fn-snapshot-notifier` | Runtime identity of `snapshot-notifier`: reads the snapshots (`storage.objectViewer` on the bucket), signs URLs with its own identity (`iam.serviceAccountTokenCreator` on itself), logs, traces. |
| Service account | `api-gateway` | Identity of the gateway. The only principal with `run.invoker` on protected functions. |
| Service account | `fn-build` | Builds the sources with Cloud Build, instead of the default compute account. Roles: log writer, Artifact Registry writer, Storage object viewer. |
| Secret | `hello-greeting` | Created by Terraform, **value added by hand** (below). |
| Bucket | `<project>-fn-sources` | Private bucket of the zipped sources. |
| Bucket | `<project>-canvas-snapshots` | Private bucket for timestamped canvas snapshots, accessed strictly via signed URLs (#135). |
| Pub/Sub Topic | `pixel-draw-events` | Message broker topic for asynchronous pixel draws and commands (#137). |
| Pub/Sub Subscription | `draw-worker-sub` | Push subscription invoking `draw-worker` with exponential retry backoff and DLQ (#137). |
| Bucket notification | snapshots bucket -> `snapshot-ready` | `OBJECT_FINALIZE` of `snapshots/*`, JSON payload (the object with its custom metadata), published by the Cloud Storage service agent (#169). |
| Pub/Sub Topic | `snapshot-ready` (+ `snapshot-ready-dlq`) | ObjectCreated events of the snapshots; 5 attempts then the dead-letter topic, kept 7 days in `snapshot-ready-dlq-inspection`. |
| Pub/Sub Subscription | `snapshot-notifier-sub` | Push subscription invoking `snapshot-notifier` with an OIDC token of `pubsub-push`. |
| Artifact Registry | `functions` | Images built for the functions (`docker_repository`), cleaned after 7 days except the 3 latest; deleted with the stack (#171). |
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

## Destroy (#171)

A `terraform destroy` of this stack leaves nothing billable and needs no manual step before it:

- Buckets (`<project>-fn-sources`, `<project>-canvas-snapshots`) have `force_destroy`: their objects
  go with them. Firestore has `deletion_policy = "DELETE"` and no delete protection. The Firebase web
  app has `deletion_policy = "DELETE"`.
- The function images live in the Terraform-managed `functions` repository (`docker_repository` on
  every function), deleted with its images. Without it Cloud Functions would create `gcf-artifacts`,
  which a destroy does not see and which keeps billing storage. The apply account needs
  `roles/artifactregistry.admin` for it (access stack).
- Functions, API Gateway (the config is `create_before_destroy`), Pub/Sub topics and subscriptions
  (their retained messages included), the bucket notification, secrets and their values, service
  accounts, alerts, dashboard and API key are all deleted.

What remains, on purpose, and costs nothing:

| Leftover | Why |
|---|---|
| `google_firebase_project`, `google_identity_platform_config` | No delete API: Firebase cannot be removed from a project, and Identity Platform cannot be turned off. A destroy forgets them. Free without monthly active users; the `discord:<id>` users stay but sign-ins stop with the stack. |
| Enabled APIs (`disable_on_destroy = false`) | Disabling an API is slow, breaks a re-apply that follows, and an enabled API costs nothing by itself. |
| Google-managed service agents (Pub/Sub, Cloud Storage, API Gateway) | Created by Google per project, not deletable, free. |
| Soft-deleted API key and Firebase web app | Kept 30 days by Google in a deleted state, then purged. Not usable, not billed. |
| Logs and traces already written | Kept until their retention ends (30 days for `_Default`), inside the free allotment. |

### Verify on dev (human, with an owner account)

1. Destroy: *Actions* -> `terraform-destroy` -> *Run workflow* on `main`, environment `dev`,
   confirm `dev` (or `gh workflow run terraform-destroy.yml --ref main -f environment=dev -f confirm=dev`).
   It destroys `serverless` then `foundation`.
2. Once only, on a project deployed before #171: delete the repository Cloud Functions created by
   itself, which no destroy can see:
   `gcloud artifacts repositories delete gcf-artifacts --location=europe-west1 --project=teampasx-cloudnative-dev`.
3. Check that nothing billable remains; every command must print nothing (or only what is said):
   ```bash
   P=teampasx-cloudnative-dev; R=europe-west1
   gcloud functions list --project=$P
   gcloud run services list --project=$P --region=$R
   gcloud api-gateway gateways list --project=$P --location=$R
   gcloud api-gateway apis list --project=$P
   gcloud pubsub topics list --project=$P --format='value(name)'
   gcloud pubsub subscriptions list --project=$P --format='value(name)'
   gcloud storage buckets list --project=$P --format='value(name)'   # only the Terraform state bucket(s)
   gcloud artifacts repositories list --project=$P --location=$R
   gcloud firestore databases list --project=$P --format='value(name)'
   gcloud secrets list --project=$P --format='value(name)'           # only secrets of the access stack, if any
   gcloud services api-keys list --project=$P
   gcloud iam service-accounts list --project=$P --format='value(email)' | grep -E 'fn-|pubsub-push|api-gateway'
   gcloud container clusters list --project=$P                        # foundation: no GKE cluster
   gcloud compute routers list --project=$P                           # foundation: no Cloud NAT router
   gcloud compute addresses list --project=$P                         # no reserved IP
   ```
   Then the *Billing* -> *Reports* page of the project, grouped by SKU, the next day: no cost after
   the destroy time.
4. Re-apply: re-run the last `terraform-deploy` run (*Re-run all jobs*), or push the next tag.
   Afterwards, as after any first deployment: add the three secret values again
   ([Configure an environment](#configure-an-environment-for-the-application-once-per-environment),
   and `hello-greeting` above), set the Discord *Interactions endpoint URL* to the new `gateway_url`
   if it changed, and rebuild the frontend with the new `frontend_build_env` (new web app ID). If
   the apply fails with `ALREADY_EXISTS` on `google_firebase_project.this` or
   `google_identity_platform_config.this` (the leftovers above), import them once with the apply
   account and re-run:
   `terraform import -var-file=dev.tfvars google_firebase_project.this projects/teampasx-cloudnative-dev`,
   `terraform import -var-file=dev.tfvars google_identity_platform_config.this projects/teampasx-cloudnative-dev/config`.
   If it fails on `google_apikeys_key.demo` because the soft-deleted `canvas-demo` still holds its
   name, restore it (`gcloud services api-keys undelete <key-uid> --project=$P`, uid from
   `gcloud services api-keys list --show-deleted`) and import it:
   `terraform import -var-file=dev.tfvars google_apikeys_key.demo projects/teampasx-cloudnative-dev/locations/global/keys/canvas-demo`.

## The application pipeline (C06 & C07)

| Component | Role | Identity and access |
|---|---|---|
| `discord-proxy` | `/discord/interactions`: checks the Ed25519 signature, answers PING; for a slash command publishes `pixel.draw` (/draw) or `discord.command` (the others) and answers a deferred response (type 5), which the worker edits | `fn-discord-proxy`, reads `discord-public-key`, publisher on `pixel-draw-events` only |
| `web-draw-proxy` | `/draw`: validates a pixel batch, publishes `pixel.draw` | `fn-web-draw-proxy`, publisher on `pixel-draw-events` only |
| `auth-callback` | `/auth/discord/callback`: Discord OAuth2 code exchange, mints a Firebase custom token for `discord:<id>` | `fn-auth-callback`, reads `discord-client-secret`, signs with its own identity |
| `pixel-draw-events` | Topic; push subscription to the worker with an OIDC token of `pubsub-push`, 5 attempts then `pixel-draw-events-dlq` (kept 7 days in `pixel-draw-events-dlq-inspection`) | |
| `draw-worker` | Draws, `/get`, `/snapshot`, `/admin *`. Ingress internal only: only the Pub/Sub push reaches it | `fn-draw-worker`: Firestore, creates objects in the snapshot bucket |
| `snapshot-ready` | Topic fed by the notification of the snapshots bucket (`OBJECT_FINALIZE`, `snapshots/*`); push subscription to the notifier with an OIDC token of `pubsub-push`, 5 attempts then `snapshot-ready-dlq` | Publisher: the Cloud Storage service agent only |
| `snapshot-notifier` | Signs a V4 read URL valid 1 hour for the new object and edits the original `/snapshot` answer. Ingress internal only | `fn-snapshot-notifier`: reads the snapshot bucket, signs with its own identity |

`/snapshot` is event-driven (C07 §2): nothing calls the notifier, the bucket event does.

```
/snapshot -> discord-proxy (deferred answer) -> pixel-draw-events -> draw-worker
  draw-worker: edits the answer "being prepared", uploads snapshots/<timestamp>.png with custom
               metadata {applicationId, interactionToken, correlationId, traceparent, requestedBy}
  bucket OBJECT_FINALIZE -> snapshot-ready -> snapshot-notifier
  snapshot-notifier: signed URL (1 h, signBlob) -> PATCH /webhooks/{applicationId}/{token}/messages/@original
```

The `traceparent` metadata carries the worker span, so the notifier span is its child in the same
Cloud Trace trace, and its logs carry the same `correlationId`. The notifier answers 200 when the
object has no interaction metadata (an object uploaded by hand) or when Discord refuses for good
(the interaction token expires after 15 minutes), and 500 on a transient failure (signing,
Discord 429/5xx or unreachable) so that Pub/Sub retries. The worker edits the answer before the
upload, so its "being prepared" message can never overwrite the link.

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

