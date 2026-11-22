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
| API Gateway | `canvas-api` / `canvas-gw` | The only public entry point. Refuses a request without a valid API key (401). |
| Cloud Run function | `hello` (Node.js 22, TypeScript) | Returns proof that it read its secret; never returns the value. |
| Service account | `fn-hello` | Runtime identity of `hello`: writes logs, reads `hello-greeting`. Nothing else. |
| Service account | `api-gateway` | Identity of the gateway. The only principal with `run.invoker` on `hello`. |
| Service account | `fn-build` | Builds the sources with Cloud Build, instead of the default compute account. Roles: log writer, Artifact Registry writer, Storage object viewer. |
| Secret | `hello-greeting` | Created by Terraform, **value added by hand** (below). |
| Bucket | `<project>-fn-sources` | Private bucket of the zipped sources. |
| API key | `canvas-demo` | Restricted to `canvas-api`. Read with `terraform output -raw demo_api_key`. |

Every identity is explicit: the function runtime, the build and the gateway each name their own
account in the code, and nothing uses the default compute account (which has Editor on the
project). A new function gets its own account and its own secret binding, as `hello` does.

The function's ingress is `ALLOW_ALL` because API Gateway does not run in the VPC; it is protected
by IAM: a call that does not carry an ID token of the `api-gateway` account gets 403.

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

## Firestore database

The stack provisions a Firestore database in Native mode (`europe-west1`), with `(default)` ID:

| Resource | Name | Role |
|---|---|---|
| Firestore database (`google_firestore_database`) | `(default)` (Native mode, `europe-west1`) | Stores the pixel grid chunks, user rate-limit counters, and canvas session flags. |

Security and operational rules:

- **Native mode**: Provides ACID transactions, document-level security rules, and real-time listeners (required for real-time frontend updates in C07).
- **Region**: Set to `europe-west1`, matching the serverless stack region.
- **Teardown**: Configured with `delete_protection_state = "DELETE_PROTECTION_DISABLED"` and `deletion_policy = "DELETE"` so `terraform destroy` tears down the stack cleanly without residual locks (mandated by C02 §6).
- **Access control**: Dedicated service accounts (e.g. worker function SA) are granted explicit roles (`roles/datastore.user`) via IAM; no public or unauthenticated access is permitted.

### Data model design (C06 §4.3)

To efficiently support a large grid of at least 10,000x10,000 pixels without storing one giant document (a common pitfall flagged in past defenses), the data layout is partitioned into tiles/chunks:

1. **Grid chunks collection (`chunks/`)**:
   - Document ID: `chunk_{chunk_x}_{chunk_y}` (e.g., `chunk_0_0` for coordinates `[0..63, 0..63]` with 64x64 tiling).
   - Document contents: map of painted pixels `pixels: { "x_y": { "color": "#RRGGBB", "author": "discord_user_id", "updated_at": "ISO8601_TIMESTAMP" } }`. Unpainted pixels are omitted to keep storage sparse and lightweight.
2. **Rate limits collection (`rate_limits/`)**:
   - Document ID: `{user_id}`.
   - Document contents: `{ "tokens": 20, "last_refill": "ISO8601_TIMESTAMP", "override_limit": null }`.
3. **Session state collection (`session/state`)**:
   - Singleton document: `{ "paused": false, "updated_by": "admin_user_id", "updated_at": "ISO8601_TIMESTAMP" }`.

### Testing and validation

#### 1. Terraform code validation
Run from repository root:
```bash
terraform -chdir=infra/serverless fmt -check
terraform -chdir=infra/serverless init -backend=false
terraform -chdir=infra/serverless validate
```

#### 2. Plan check against dev / prd
```bash
terraform -chdir=infra/serverless init -reconfigure -backend-config=backends/dev.hcl
terraform -chdir=infra/serverless plan -var-file=dev.tfvars
```
Verify the output indicates:
`# google_firestore_database.canvas will be created` with `name = "(default)"`, `type = "FIRESTORE_NATIVE"`, `location_id = "europe-west1"`.

#### 3. Post-apply cloud verification (gcloud)
Once deployed by CI/CD or applied manually on `dev`:
```bash
# Describe the database and verify it is ACTIVE in Native mode
gcloud firestore databases describe --database="(default)" --project=teampasx-cloudnative-dev

# Verify location and deletion settings
gcloud firestore databases describe --database="(default)" --project=teampasx-cloudnative-dev \
  --format="yaml(name, locationId, type, deleteProtectionState)"
```
Expected output:
- `locationId: europe-west1`
- `type: FIRESTORE_NATIVE`
- `deleteProtectionState: DELETE_PROTECTION_DISABLED`

#### 4. IAM and access test
Verify that the default compute engine service account does not have write access and that only explicit service accounts (e.g. worker function identity with `roles/datastore.user`) can interact with documents:
```bash
# Verify IAM policy bindings on the project or database
gcloud projects get-iam-policy teampasx-cloudnative-dev \
  --flatten="bindings[].members" \
  --filter="bindings.role:roles/datastore.user"
```

#### 5. Teardown test
During `terraform destroy -var-file=dev.tfvars`, verify that `google_firestore_database.canvas` is destroyed cleanly without requiring manual console overrides.

## Next (C06)

The proxy pattern replaces `hello`: a Discord proxy that checks the Ed25519 signature and
publishes to Pub/Sub. When a second function appears, the service account, the function and its
IAM binding become a local module (ADR-0004).
