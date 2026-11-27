# Security walk-through (Issue #93)

The security points of subject §5.3, each with where it is defined and how to prove it live. The
commands assume prd (`gcloud config set project teampasx-cloudnative-prd`); replace with dev as
needed. `GW` is `terraform -chdir=infra/serverless output -raw gateway_url`.

The reference is `main` plus three pull requests:

- #176: discord-proxy publishes, plus Cloud Trace spans;
- #177: Firebase Hosting;
- #178: snapshot-notifier.

## 1. Claims and proofs

| Claim | Where | Proof |
|---|---|---|
| One service account per component, none uses the default compute account | `infra/serverless/iam.tf`, `pubsub.tf`; `service_account_email` / `build_config.service_account` in `function_*.tf` | *IAM > Service accounts*; `gcloud functions describe draw-worker --region europe-west1 --format='value(serviceConfig.serviceAccountEmail)'` |
| The proxies are not public: only the gateway may invoke them | `google_cloud_run_v2_service_iam_member.gateway_invokes_*` (no `allUsers`) | `curl -i <function URL>` -> 403; `gcloud run services get-iam-policy web-draw-proxy --region europe-west1` shows only `serviceAccount:api-gateway@...` |
| The workers cannot be reached from the internet | `ingress_settings = "ALLOW_INTERNAL_ONLY"` on `draw-worker` and `snapshot-notifier`; invoker = `pubsub-push` only (`pubsub.tf`) | `curl -i -X POST <draw-worker URL>` is refused; `gcloud run services get-iam-policy snapshot-notifier --region europe-west1` |
| The gateway authenticates to the functions without a key | `x-google-backend.jwt_audience` in `openapi.yaml.tftpl`; `backend_config.google_service_account` in `gateway.tf`; TokenCreator of the API Gateway service agent on `api-gateway` (`iam.tf`) | A call through `$GW` works, a direct call gets 403 |
| `/draw` needs a valid Firebase ID token, checked before any function runs | `securityDefinitions.firebase` (issuer `securetoken.google.com/{project}`, audience `{project}`) on `POST /draw` | `curl -i -X POST "$GW/draw" -d '{}'` -> 401 from the gateway; `web-draw-proxy` also refuses a UID that is not `discord:<digits>` (`auth.ts`) |
| Discord requests are signature-checked before anything else | `app/functions/discord-proxy/src/signature.ts` (Node `crypto.verify`, Ed25519 over timestamp + raw body), called first in `index.ts`; key from secret `discord-public-key` | `curl -i -X POST "$GW/discord/interactions" -H 'Content-Type: application/json' -d '{"type":1}'` -> 401; tests `signature.test.ts`, `proxy.test.ts`; Discord refuses to save an endpoint that fails its signed PING |
| Buckets are private; snapshots go out only through V4 signed URLs valid 1 hour | `public_access_prevention = "enforced"`, `uniform_bucket_level_access` in `bucket_snapshots.tf` and on the sources bucket (`function_hello.tf`); `getSignedUrl({version:'v4'})`, `SIGNED_URL_SECONDS = 3600`, in `snapshot-notifier/src/index.ts` | Object URL without signature -> 403; the signed link works, then stops after 1 h |
| Separation of duties on the snapshots | `draw-worker` has only `storage.objectCreator` (cannot read, list, overwrite or sign); `snapshot-notifier` has only `storage.objectViewer` + TokenCreator on itself. A URL signed by it grants no more than read | `gcloud storage buckets get-iam-policy gs://teampasx-cloudnative-prd-canvas-snapshots` |
| Secrets live in Secret Manager; Terraform creates the secret, never its value | `infra/serverless/secrets.tf`, `infra/access/runner_secret.tf`, `grafana_secret.tf` | `gcloud secrets get-iam-policy <secret>`: one accessor each (§3); `terraform state show` holds no value |
| No long-lived cloud key in GitHub | WIF pool `github`, provider `github-actions` (`infra/access/main.tf`); `.github/actions/terraform-init` uses `google-github-actions/auth` with `workload_identity_provider`; `frontend-deploy.yml` reuses those credentials for firebase-tools (no `FIREBASE_TOKEN`) | Repository secrets hold no GCP key; `gcloud iam service-accounts keys list --iam-account=github-apply@teampasx-cloudnative-prd.iam.gserviceaccount.com --managed-by=user` -> empty; `auth-check` workflow |
| The apply identity is usable only from its own GitHub environment | `apply_from_environment` binds `attribute.environment/{env}`; `attribute_condition` limits the repository | `auth-check` jobs *apply account is refused outside an environment* and *prd apply account is refused to a job of the dev environment* pass |
| prd changes need a human approval | GitHub environment `prd` with required reviewers (the three members) | The `*-prd` jobs of `terraform-deploy` wait on *Review deployments* |
| Signing without key files | `roles/iam.serviceAccountTokenCreator` of `fn-auth-callback` and `fn-snapshot-notifier` **on themselves** (IAM signBlob) | No user-managed key on any SA: `gcloud iam service-accounts keys list --iam-account=<sa> --managed-by=user` |
| HTTPS everywhere | Gateway `schemes: [https]`; Cloud Run functions, Firebase Hosting, Firestore, Cloud Trace API and Discord are HTTPS only | Every URL in the demo is `https://`. What `http://` on the gateway answers is to be checked live |
| Clients cannot write to the database | `infra/serverless/firestore.rules`: deny by default, `allow write: if false` everywhere, read of `chunks` and `config` only if `request.auth != null`, nothing on `ratelimits` | A write from the browser console fails with *Missing or insufficient permissions* |
| Admin commands are checked by the backend | The proxy has no business logic. `isUserAdmin` in `draw-worker/src/admin-auth.ts` checks the role `ADMIN_ROLE_ID`, `ADMIN_USER_IDS` and `config/system.admins` | `/admin pause` from a non-admin -> refused, logged *Unauthorized admin command* |
| Credentials are not logged | `snapshot-notifier` never logs the signed URL or the interaction token (comment in `index.ts`) | Logs Explorer on `snapshot-notifier` |
| Secrets are not committed | `secret-scan` (gitleaks, whole history) on every PR and push to `main`; required by the ruleset | green `secret-scan` check |
| Signed commits, reviewed pull requests | Ruleset `protect-main` (§4); [development.md](development.md#commit-and-tag-signing) | *Settings > Rules > Rulesets* |

## 2. Service accounts and their roles

From `infra/serverless/iam.tf`, `pubsub.tf`, `secrets.tf`, the `function_*.tf` invoker bindings and
`infra/access/main.tf`. "On X" means the grant is on that one resource, not on the project.

| Service account | Runs | Roles |
|---|---|---|
| `api-gateway` | API Gateway backend calls | `roles/run.invoker` on `hello`, `discord-proxy`, `web-draw-proxy`, `auth-callback`. The API Gateway service agent has `roles/iam.serviceAccountTokenCreator` on it, to mint the ID tokens |
| `fn-discord-proxy` | discord-proxy | `roles/logging.logWriter`, `roles/cloudtrace.agent`; `roles/secretmanager.secretAccessor` on `discord-public-key`; `roles/pubsub.publisher` on `pixel-draw-events` |
| `fn-web-draw-proxy` | web-draw-proxy | `roles/logging.logWriter`, `roles/cloudtrace.agent`; `roles/pubsub.publisher` on `pixel-draw-events` |
| `fn-auth-callback` | auth-callback | `roles/logging.logWriter`, `roles/cloudtrace.agent`; `roles/secretmanager.secretAccessor` on `discord-client-secret`; `roles/iam.serviceAccountTokenCreator` on itself (Firebase custom tokens) |
| `fn-draw-worker` | draw-worker | `roles/logging.logWriter`, `roles/datastore.user`, `roles/cloudtrace.agent`; `roles/storage.objectCreator` on `{project}-canvas-snapshots`. No Pub/Sub role: it is pushed to |
| `fn-snapshot-notifier` | snapshot-notifier | `roles/logging.logWriter`, `roles/cloudtrace.agent`; `roles/storage.objectViewer` on `{project}-canvas-snapshots`; `roles/iam.serviceAccountTokenCreator` on itself (signed URLs). No Pub/Sub role: it is pushed to |
| `pubsub-push` | OIDC token of the push subscriptions `draw-worker-sub` and `snapshot-notifier-sub` | `roles/run.invoker` on `draw-worker` and on `snapshot-notifier`. The Pub/Sub service agent has TokenCreator on it, plus publisher on both DLQ topics and subscriber on both source subscriptions (dead-lettering) |
| Cloud Storage service agent (Google-managed) | bucket notification `snapshot-ready` | `roles/pubsub.publisher` on `snapshot-ready` only |
| `fn-hello` | hello (C05 demo) | `roles/logging.logWriter`, `roles/cloudtrace.agent`; `roles/secretmanager.secretAccessor` on `hello-greeting` |
| `fn-build` | Cloud Build of every function, images to the Artifact Registry repository `functions` | `roles/logging.logWriter`, `roles/artifactregistry.writer`, `roles/storage.objectViewer` |
| `github-plan` | PR workflows (any workflow of the repository) | `roles/viewer`, `roles/iam.securityReviewer`, `roles/serviceusage.serviceUsageConsumer`, `roles/serviceusage.apiKeysViewer`, custom `helmStateReader` (`container.secrets.get/list`); `roles/storage.objectAdmin` on the state bucket |
| `github-apply` | jobs of the GitHub environment `{env}`: `terraform-run`, `frontend-deploy` | Scoped admin roles, **no Editor** (`infra/access/main.tf`); `roles/storage.objectAdmin` on the state bucket. The roles: networkAdmin, container.admin, serviceUsageAdmin, serviceAccountAdmin/User, projectIamAdmin, secretmanager.admin, run.admin, cloudfunctions.admin, apigateway.admin, apiKeysAdmin, storage.admin, monitoring.admin, logging.admin, pubsub.admin, datastore.owner, firebaserules.admin, firebase.admin (also deploys Hosting), identityplatform.admin, serviceAccountTokenCreator, artifactregistry.admin |
| KSA `external-secrets` (Workload Identity) | External Secrets Operator | `roles/secretmanager.secretAccessor` on `arc-github-token`, `arc-github-app-id`, `arc-github-app-installation-id`, `arc-github-app-private-key`, `grafana-admin-password` only |
| KSA `grafana` (Workload Identity) | Grafana | `roles/monitoring.viewer` |

What to say: `github-apply` still holds broad admin roles (projectIamAdmin, secretmanager.admin). A
Terraform identity that creates IAM bindings and secrets needs them. They are reduced by limiting
**who** can use the account (one GitHub environment, one repository, a reviewer for prd), not by
limiting **what** it can do.

## 3. Secrets: which one, who reads it

| Secret | Stack | Read by | Value added by |
|---|---|---|---|
| `discord-public-key` | serverless | `fn-discord-proxy` (cached per instance) | a team member, `gcloud secrets versions add` |
| `discord-client-secret` | serverless | `fn-auth-callback`, at request time | a team member ([serverless.md](serverless.md)) |
| `hello-greeting` | serverless | `fn-hello` | a team member |
| `arc-github-app-id`, `arc-github-app-installation-id`, `arc-github-app-private-key`, `arc-github-token` | access (`prevent_destroy`) | External Secrets Operator -> K8s secret `arc-github` in `arc-runners` | an Owner ([infra.md](infra.md)) |
| `grafana-admin-password` | access (`prevent_destroy`) | External Secrets Operator -> K8s secret `grafana-admin` in `monitoring` | an Owner |

Other credentials:

- **Discord bot token.** Used to register the slash commands, it is a GitHub **repository secret**
  (`DISCORD_BOT_TOKEN`, workflow `register-discord-commands`). It is a Discord credential, not a
  cloud key.
- **Discord interaction token.** It travels in the event and in the snapshot object's metadata. It
  is valid 15 minutes and only allows editing that one answer.
- **Firebase web configuration** (API key, app ID). It is public by design and grants nothing by
  itself: the rules and the gateway decide.

## 4. Repository and workflow controls

- **Ruleset `protect-main`**, active on `main`. It requires:
  - a pull request with 1 approving review;
  - signed commits;
  - the gitleaks check;
  - no force push, no deletion.

  New unsigned commits cannot reach `main` any more. GitHub reports 24 unverified commits out of 197
  on `main`, all from before the ruleset. (A local `git log --format=%G?` cannot verify SSH
  signatures, so it shows more.)
- **GitHub environments.** `dev` and `prd` hold the apply account. `prd` requires a reviewer (the
  three members), so nothing reaches prd without a second person.
- **Release guards.** A release needs a tag whose commit is on `main` (`check-tag`), and prd waits
  for the whole of dev, frontend included. Destroy runs from `main` only, with a typed
  confirmation.
- **Visibility.** The repository is **public** in a free organization, which is why the ruleset and
  the environment reviewers are enforced. Subject §1.2 asks for a private repository. This is an
  open decision, see [defense-checklist.md](defense-checklist.md). The GitHub account Kloox has read access
  on the repository.
- **Least privilege in workflows.** Every workflow declares `permissions: contents: read`. Only
  the Terraform, auth and frontend-deploy workflows add `id-token: write`, which they need for OIDC.
- **Supply chain.** Pinned versions:
  - gitleaks: version pinned and checked with SHA-256;
  - Terraform 1.9.8;
  - firebase-tools 15.36.0;
  - Helm charts `0.9.3`, `2.13.0`, `14.3.1`.

## 5. Network and data

- GKE nodes are private (`enable_private_nodes`), egress through Cloud NAT. The control plane has a
  public endpoint (`enable_private_endpoint = false`), protected by Google authentication.
- Grafana has no public address (`ClusterIP`). It is reached with `kubectl port-forward`.
- Firestore and Cloud Storage are encrypted at rest by Google (default keys).
- `force_destroy = true` on the buckets is deliberate: the stack must be disposable (destroy
  workflow, #171). Snapshots are kept 30 days at most. Function images are cleaned after 7 days,
  except the 3 latest.
- The Discord access token is never stored. `auth-callback` only keeps the user ID and name in the
  Firebase custom token. The redirect URI is fixed by configuration, so a caller cannot redirect
  the token elsewhere.
