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
| Firestore database | `(default)` (Native mode, `europe-west1`) | Stores the pixel grid state and user rate-limit counters. |

Security and operational rules:

- **Native mode**: Provides ACID transactions, document-level security rules, and real-time listeners.
- **Region**: Set to `europe-west1`, matching the serverless stack region.
- **Teardown**: Configured with `delete_protection_state = "DELETE_PROTECTION_DISABLED"` and `deletion_policy = "DELETE"` so `terraform destroy` tears down the stack cleanly without residual locks.
- **Access control**: Dedicated service accounts (e.g. worker function SA) are granted explicit roles (`roles/datastore.user`) via IAM; no public access is permitted.

## Next (C06)

The proxy pattern replaces `hello`: a Discord proxy that checks the Ed25519 signature and
publishes to Pub/Sub. When a second function appears, the service account, the function and its
IAM binding become a local module (ADR-0004).
