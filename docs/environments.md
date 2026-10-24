# Environments

What exists in each GCP project, and where it comes from. Read it before creating, importing or
deleting anything in a project, and to know what the Terraform code does and does not manage.

The values that configure each environment (project ID, region, network ranges, state bucket) are
in `infra/<stack>/<env>.tfvars` and `infra/<stack>/backends/<env>.hcl`; this page does not repeat
them. How to run the code is in [infra.md](infra.md). The inventory below was read from the
projects with `gcloud` on **2026-10-23**, after the access stack was applied; it describes that
day and drifts as people work, so re-read the project before relying on it.

| | dev | prd |
|---|---|---|
| Project ID | `teampasx-cloudnative-dev` | `teampasx-cloudnative-prd` |
| Project number | 812267599723 | 1024204425086 |
| Created | 2026-10-22 | 2026-10-23 |
| Billing | enabled; one budget with alerts, in the access stack (`01A021-589B0D-8ED8BC`) | enabled; one budget with alerts, in the access stack (`01A021-589B0D-8ED8BC`) |
| Foundation stack (Network) | applied 2026-10-23 (VPC, subnet, router, NAT) | applied 2026-10-23 (VPC, subnet, router, NAT) |
| Access stack | applied 2026-10-23, 16 resources | applied 2026-10-23, 16 resources |

## Managed by Terraform

### Foundation stack (Networking), in both projects

Defined in `infra/foundation`, applied on 2026-10-23. The design is in
[ADR-0013](adr/0013-network-topology-and-ip-addressing.md) and the topology in
[infra.md](infra.md#network-topology). Each project holds:

| Resource | dev | prd | Purpose |
|---|---|---|---|
| VPC (`google_compute_network`) | `teampasx-dev-vpc` | `teampasx-prd-vpc` | Dedicated custom-mode VPC |
| Subnet (`google_compute_subnetwork`) | `teampasx-dev-vpc-subnet` (`10.10.0.0/24`) | `teampasx-prd-vpc-subnet` (`10.20.0.0/24`) | Primary subnet for GKE nodes with Private Google Access |
| Pods Range (secondary) | `teampasx-dev-vpc-pods` (`10.11.0.0/16`) | `teampasx-prd-vpc-pods` (`10.21.0.0/16`) | Alias IP range for Kubernetes Pods |
| Services Range (secondary) | `teampasx-dev-vpc-services` (`10.12.0.0/20`) | `teampasx-prd-vpc-services` (`10.22.0.0/20`) | Alias IP range for Kubernetes Services |
| Cloud Router (`google_compute_router`) | `teampasx-dev-vpc-router` | `teampasx-prd-vpc-router` | Regional router in `europe-west1` |
| Cloud NAT (`google_compute_router_nat`) | `teampasx-dev-vpc-nat` | `teampasx-prd-vpc-nat` | Egress NAT for private nodes and runners |

### Access stack, in both projects

Defined in `infra/access`, applied by hand on 2026-10-23 with a project Owner's login. The design
is in [ADR-0011](adr/0011-workload-identity-in-the-access-stack.md) and the behaviour in
[infra.md](infra.md#github-actions-authentication). Each project holds the same 16 resources:

| Resource | Name | Purpose |
|---|---|---|
| Workload identity pool | `github` | Trust anchor for GitHub Actions |
| Pool provider | `github-actions` | Accepts GitHub's OIDC tokens, only from `R-PalaceOnDanse/Cloud-Native-DevOps` |
| Service account | `github-plan` | Read-only identity for `terraform plan`, usable by any workflow of the repository |
| Service account | `github-apply` | Identity for apply and destroy, usable only by the GitHub environment of the same name as the project's environment |
| Project roles of `github-plan` | Viewer, Security Reviewer | Refresh the state and read IAM policies |
| Project roles of `github-apply` | Editor, Project IAM Admin | Create resources and their IAM bindings |
| State bucket role | `roles/storage.objectAdmin` on the bucket, for both accounts | Terraform writes a lock even for a plan |
| Impersonation bindings | `roles/iam.workloadIdentityUser` on each account | Who may use each account, as described above |
| Enabled APIs | Cloud Resource Manager, IAM, IAM Credentials, Security Token Service | Required by the federation; left enabled on destroy |

The full names of the provider and of the two accounts are the outputs of the stack
(`terraform -chdir=infra/access output`).

## Not managed by Terraform

Created by hand, or by someone else, and not described by any code in this repository.

### In both projects

- **The project itself, its billing link and its human access.** Three team members are Owner. One
  of them also holds *Project Mover* on dev.
- **The state bucket** (`state_bucket_dev`, `state_bucket_prd`), created by hand before the first
  `init`, in `europe-west9`. Its properties are in [infra.md](infra.md#rules); creating one is
  described there.
- **The APIs enabled by default on a new project** (BigQuery, Cloud Storage, Logging, Monitoring
  and similar).

### Only in dev, found on 2026-10-23

These were not created by this repository's Terraform. Who created them, and why, is not
recorded: **Unknown, the team can answer**, and the answer belongs in the decisions log.

- **A second federation, removed on 2026-10-23.** A pool `github-actions` and a service account
  `github-terraform-dev` (Compute Network Admin) had been created by hand in dev, next to the
  `github` pool of the access stack. The pipelines use the access stack's pool, which `auth-check`
  proves works in both projects, so both were deleted (a deleted pool or account can be restored
  for 30 days). Nothing outside the access stack now authenticates GitHub Actions.
- **Firebase and related APIs**: Firebase, Firebase Hosting, Firebase Rules, Identity Toolkit,
  App Engine, Datastore, FCM, Remote Config, and the service account `firebase-adminsdk-…`. They
  are the kind of services that [ADR-0008](adr/0008-firestore-listeners-for-realtime.md) and
  [ADR-0009](adr/0009-firebase-hosting-and-discord-oauth.md) rely on, and may come from the spike
  those ADRs ask for. Nothing in the code uses them yet.
- **The instructor's access**: the instructor has the *Editor* role on dev. On prd the instructor
  has no role, which the project owner chose to leave as it is (the subject asks for access to
  both environments; see issue #22).
- **Budget Alerts API** (`billingbudgets.googleapis.com`) is enabled in dev and prd. The budget of each project is created by `infra/access/budget.tf` and managed in the `access` stack with `prevent_destroy = true`. Both projects share the team billing account `01A021-589B0D-8ED8BC`.

### Only in prd

Nothing beyond the access stack, the state bucket and the human access listed above.

## Not created yet

- The GKE cluster and the runners, the serverless components (Pub/Sub, API Gateway, functions,
  Firestore, Secret Manager) and the monitoring. The Secret Manager API is not enabled in either
  project.
