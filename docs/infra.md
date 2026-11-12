# Infrastructure

How the Terraform code under `infra/` is organised, where each environment's values live, and how
to run it. Read by anyone who plans or changes cloud resources.

The decisions behind this layout are in [ADR-0004](adr/0004-terraform-layout-and-environments.md), and the network topology in [ADR-0013](adr/0013-network-topology-and-ip-addressing.md).
Three stacks exist:

- `foundation`: the foundational infrastructure of each environment: VPC network, subnets with GKE
  secondary ranges, Cloud Router, Cloud NAT, and the private GKE cluster dedicated to self-hosted
  GitHub Actions runners.
- `serverless`: the application (API Gateway, Cloud Run functions, secrets), described in
  [serverless.md](serverless.md).
- `access`: how GitHub Actions authenticates to Google Cloud without a key (Workload Identity
  Federation), budget alerts, and human access (team and instructor). Human access to both projects
  is managed in `infra/access/members.tf` so that destroying `foundation` never locks anyone out.

## Layout

Every stack has the same files:

```
infra/<stack>/
  backend.tf          empty GCS backend, filled at init time
  backends/<env>.hcl  state bucket and prefix of an environment
  <env>.tfvars        project, region and other values of an environment
  main.tf             the resources
  variables.tf        inputs, with validation
  outputs.tf          values other code needs
  providers.tf        Terraform and provider version constraints
```

`<stack>` is `foundation`, `serverless` or `access`, and `<env>` is `dev` (`teampasx-cloudnative-dev`) or `prd`
(`teampasx-cloudnative-prd`). Both environments run the same code; only `backends/<env>.hcl` and
`<env>.tfvars` differ. These two files are the single source of truth for the project IDs, the
region, the network names and ranges, and the state buckets: read them rather than copying their
values elsewhere. None of them is a secret, so they are committed. Full environment and project
descriptions live in [environments.md](environments.md).

## Rules

- **One region: `europe-west1` (Belgium)** for every regional resource, in both environments. It is
  one of the regions where API Gateway can be created ([ADR-0006](adr/0006-api-gateway-cloud-run-functions-pubsub.md)).
  `europe-west9` is not supported by API Gateway.
- **State** lives in a GCS bucket per environment, one prefix per stack (`foundation` here). The
  state buckets were created by hand before the first `terraform init`, as they cannot be created
  by the code that stores its state in them (see [Create a state bucket](#create-a-state-bucket)).
  The two existing buckets are in `europe-west9`, with uniform bucket-level access and public
  access prevention enforced and the default 7-day soft delete; **object versioning is not
  enabled on them**. A bucket location cannot be changed afterwards; moving them to `europe-west1`
  means creating new buckets and migrating the state.
- **Networks do not overlap**: dev uses `10.10.0.0/24` and prd `10.20.0.0/24`, so the two can be
  peered or connected later.
- **No workspaces.** The environment is chosen by the two files above, never by a workspace.
- **Apply and destroy** of `foundation` are done by the pipeline ([ci.md](ci.md)): a release tag
  applies, the destroy workflow destroys. Do not run them from a laptop. The `access` stack is the
  exception: it is applied by hand by a project Owner, after its pull request is approved.

## Secrets

One place per kind of secret ([ADR-0015](adr/0015-secrets-in-secret-manager.md)). Terraform creates
a secret but never its value, because it would be written in the state.

| Kind | Where it lives | Who adds the value | Rotation |
|---|---|---|---|
| Runtime secret (function, runner) | Secret Manager | a team member: `gcloud secrets versions add <name> --data-file=-` | add a new version, then disable the old one |
| Pipeline configuration | GitHub repository variables | an Owner, from the `access` outputs ([ci.md](ci.md)) | `gh variable set` |
| Secret needed in the cluster | Kubernetes secret synced from Secret Manager | nobody | rotate it in Secret Manager |

No Terraform variable holds a secret. gitleaks scans the whole history on every pull request
(`secret-scan`), and before a commit once the hooks are active.

## Network topology

The `foundation` stack manages the networking resources for each environment. Both environments
use non-overlapping IP address spaces to allow peering:

| Environment | VPC Name | Primary Subnet (Nodes) | Pods Secondary Range | Services Secondary Range | Egress NAT |
|---|---|---|---|---|---|
| **dev** | `teampasx-dev-vpc` | `10.10.0.0/24` (256 IPs) | `10.11.0.0/16` (65,536 IPs) | `10.12.0.0/20` (4,096 IPs) | Cloud Router + Cloud NAT |
| **prd** | `teampasx-prd-vpc` | `10.20.0.0/24` (256 IPs) | `10.21.0.0/16` (65,536 IPs) | `10.22.0.0/20` (4,096 IPs) | Cloud Router + Cloud NAT |

- **Private Google Access** is enabled on each subnet so that private GKE nodes can reach Google APIs
  without public IPs.
- **Cloud NAT** provides outbound internet connectivity for private nodes/pods to pull images and packages
  without exposing external IP addresses.
- **Tear-down**: `terraform destroy` removes all network resources (including the hourly
  billable Cloud NAT gateway and Cloud Router). The budget alerts live in the `access` stack
  with `prevent_destroy = true`, so destroying `foundation` leaves the budget safeguards intact
  and runs cleanly.

## GKE Cluster & Runner Node Pools

The `foundation` stack provisions a private, managed Google Kubernetes Engine (GKE) cluster in each
environment (`dev` and `prd`).

### Role & Architectural Constraint

In accordance with the project constraints (C05, C06):
- **100% Serverless Application**: Application workloads (pixel drawing, Discord bot proxy, workers,
  and real-time streaming) are strictly forbidden on GKE. The entire application runs serverless.
- **Dedicated CI/CD Infrastructure**: The GKE cluster is exclusively reserved for hosting
  self-hosted GitHub Actions runners (Action Runner Controller - ARC), cert-manager, metrics, and
  cluster-level controllers.

### Cluster Specification & Topology

The cluster resource is defined in `infra/foundation/gke.tf`:

| Property | Value | Justification / Details |
|---|---|---|
| **Resource** | `google_container_cluster.primary` | Declarative GKE control plane managed by Terraform |
| **Cluster Name** | `${var.vpc_name}-gke` | `teampasx-dev-vpc-gke` in dev, `teampasx-prd-vpc-gke` in prd |
| **Location** | `${var.region}-b` (`europe-west1-b`) | Zonal cluster pinned to zone `b` to avoid inter-zone egress latency/costs and regional capacity limits |
| **Network & Subnet** | `google_compute_network.main.id` / `google_compute_subnetwork.subnet_k8s.id` | Attached to the primary subnet (`10.10.0.0/24` in dev, `10.20.0.0/24` in prd) |
| **IP Allocation Policy** | Alias IP / VPC-native | Pods use `pods-range` (`10.11.0.0/16` dev, `10.21.0.0/16` prd); Services use `services-range` (`10.12.0.0/20` dev, `10.22.0.0/20` prd) |
| **Private Nodes** | `enable_private_nodes = true` | Cluster nodes do not receive external public IP addresses; outbound traffic uses Cloud NAT |
| **Control Plane Endpoint** | `enable_private_endpoint = false` | Endpoint is publicly reachable with Google IAM authentication, allowing direct operator and CI access without a bastion |
| **Master CIDR** | `172.16.0.0/28` | Dedicated private /28 block for GKE master control plane peering |
| **Default Node Pool** | `remove_default_node_pool = true` | Default pool deleted immediately; workloads run strictly in custom, purpose-built node pools |
| **Deletion Protection** | `deletion_protection = false` | Ensures `terraform destroy` tears down the cluster cleanly without retention locks |
| **Autoscaling Profile** | `OPTIMIZE_UTILIZATION` | Aggressively bin-packs pods to allow idle nodes to scale down quickly |

### Dedicated Node Pools

Compute resources are separated into two specialized node pools:

#### 1. System Node Pool (`system-pool`)
- **Node Count**: Fixed `1` node (`e2-small`: 2 vCPU burstable, 2 GB RAM, 20 GB pd-standard disk).
- **Purpose**: Runs essential cluster daemonsets and controllers (CoreDNS, kube-proxy, cert-manager, metrics-server, and runner controllers).
- **Labels**: `role = "system"`.
- **Management**: `auto_repair = true` and `auto_upgrade = true`.

#### 2. Runner Node Pool (`runner-pool`)
- **Autoscaling**: `min_node_count = 0`, `max_node_count = 2` (dynamically scales to zero when no CI jobs are running).
- **Machine Type**: `e2-medium` (2 vCPU, 4 GB RAM, 20 GB pd-standard disk).
- **Cost Safeguard (Spot VMs)**: Configured with `spot = true` to use Google Cloud Spot VMs, slashing compute costs by 60% to 91% compared to standard on-demand VMs.
- **Taint Isolation**: Configured with `taint { key = "runner", value = "true", effect = "NO_SCHEDULE" }` and label `role = "runner"`. This guarantees that system pods never schedule on runner nodes, allowing the pool to scale down to 0 instances when idle.
- **Management**: `auto_repair = true` and `auto_upgrade = true`.

### Connecting & Operating the Cluster

To configure `kubectl` credentials locally for an environment:

```bash
# Connect to dev cluster
gcloud container clusters get-credentials teampasx-dev-vpc-gke \
  --zone europe-west1-b \
  --project teampasx-cloudnative-dev

# Connect to prd cluster
gcloud container clusters get-credentials teampasx-prd-vpc-gke \
  --zone europe-west1-b \
  --project teampasx-cloudnative-prd
```

Inspect cluster nodes, labels, and taints:

```bash
# List all nodes with their assigned roles and node pools
kubectl get nodes -L role,cloud.google.com/gke-nodepool

# Check runner taint on runner nodes
kubectl describe nodes -l role=runner | grep -E "(Taints|Allocated resources)"
```

### Runner token

The runners register with a GitHub token. It never goes through Terraform, so it is not in the
state ([ADR-0016](adr/0016-external-secrets-operator.md)). It lives in Secret Manager, in the
secret `arc-github-token` of each project, created by the `access` stack. External Secrets Operator
copies it into the Kubernetes secret `arc-github` (namespace `arc-runners`) that the Helm release
names, and refreshes it every hour.

Add the value once per environment, after the `access` stack is applied. The token needs the
`repo` scope:

```bash
printf '%s' '<token>' | gcloud secrets versions add arc-github-token \
  --project=teampasx-cloudnative-dev --data-file=-
```

To rotate it, create a new token, add it as a new version (same command), then revoke the old
token. The cluster picks it up within the hour; to force it now:

```bash
kubectl annotate externalsecret arc-github --namespace arc-runners force-sync=$(date +%s) --overwrite
```

A cluster that is destroyed and rebuilt finds its secret by itself: the value stays in Secret
Manager. Check the copy with `kubectl get externalsecret --namespace arc-runners` (status
`SecretSynced`).

### Clean Teardown

The cluster and its node pools are declared without `prevent_destroy` or `deletion_protection`. Running `terraform destroy` on `infra/foundation` removes the runner node pool, system node pool, GKE cluster, subnets, and Cloud NAT cleanly in dependency order without leaving orphan cloud resources.

## Run it

Prerequisites: the tools of [development.md](development.md) (Terraform 1.9 comes from mise), and a
Google login that can read the project and the state bucket.

```bash
gcloud auth login
gcloud auth application-default login
```

Then, from the repository root, for one stack and one environment (`foundation` and `dev` here):

```bash
terraform -chdir=infra/foundation init -reconfigure -backend-config=backends/dev.hcl
terraform -chdir=infra/foundation plan -var-file=dev.tfvars
```

`-reconfigure` makes the switch to another environment or stack safe: run the same two commands
with `prd`, or with `infra/access`, to plan those. Use the Terraform version pinned by mise: a state written by a newer Terraform cannot
be read by an older one, and `required_version` in `providers.tf` refuses any other minor version.

Checks that must pass before a pull request, for each stack you changed:

```bash
terraform -chdir=infra/foundation fmt -check
terraform -chdir=infra/foundation validate
```

## GitHub Actions authentication

The `access` stack lets the pipelines act on a project without any key stored in GitHub, using
Workload Identity Federation ([ADR-0011](adr/0011-workload-identity-in-the-access-stack.md)). In
each project it creates:

- a workload identity pool `github` and a provider `github-actions` that trusts GitHub's OIDC
  tokens, and refuses every token that does not come from the repository named in
  `github_repository`;
- the service account `github-plan`, read-only (Viewer and Security Reviewer on the project), which
  any workflow of the repository may impersonate. Plans use it, including on pull requests;
- the service account `github-apply`, which creates and changes resources (Editor and Project IAM
  Admin on the project), and which only a job that runs in the GitHub environment of the same name
  as the Terraform environment (`dev` or `prd`) may impersonate;
- the write access of both accounts to the state bucket, because Terraform locks the state even
  for a plan.

The three values a workflow needs for an environment are the stack's outputs
(`workload_identity_provider`, `plan_service_account`, `apply_service_account`); they are kept as
repository variables and passed to `google-github-actions/auth` with `id-token: write` permission. The pipelines that do so are described in [ci.md](ci.md).

The first `apply` of this stack is done by hand with the Google login of a project Owner, because
the pipeline cannot authenticate before this stack exists. After that, changes to it go through a
pull request like any other, but are still applied by hand, since this stack is the identity the
pipeline runs with.

`state_bucket` in `<env>.tfvars` repeats the bucket of `backends/<env>.hcl`, as Terraform cannot
read its own backend configuration: change both together.

## Human access

Human access to the GCP projects is managed as code in `infra/access/members.tf`. Keeping these permissions in the `access` stack guarantees that running `terraform destroy` on `infra/foundation` removes the networking infrastructure without ever locking team members or the instructor out:

- **Instructor**: `jeremie@jjaouen.com` is granted `roles/editor` on both `dev` and `prd` (`instructor_email` variable).
- **Team members**: `aurelienbara13@gmail.com`, `nicolaslouis320@gmail.com`, and `quaduval@gmail.com` are granted `roles/owner` on both projects (`team_members` variable).

## Create a state bucket

Done once per environment, by a member who is Owner of that environment's project, before the
first `terraform init`. Terraform cannot create the bucket that holds its own state. The bucket is
private, uniform-access, in the common region, and versioned so that an overwritten or deleted
state can be recovered:

```bash
gcloud storage buckets create gs://state_bucket_dev \
  --project=teampasx-cloudnative-dev --location=europe-west1 \
  --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update gs://state_bucket_dev --versioning
```

Use `prd` and `teampasx-cloudnative-prd` for the other environment. Then put the bucket name in
`infra/<stack>/backends/<env>.hcl` of each stack and run `terraform init` as described above. Anyone who is
Editor or Owner of the project can read and write the state through the bucket's default
project-level roles; there is no bucket-specific access list. Bringing the buckets under Terraform
control is planned for the section 1 issues.

## Budget alerts

To prevent accidental credit burns from autoscaling or resource misconfigurations, each project has
a monthly budget with alerts. The budgets are defined in `infra/access/budget.tf` and managed as part
of the `access` stack (which is never destroyed). The billing account and monthly amount of each
environment are `billing_account` and `budget_amount` in `infra/access/<env>.tfvars`, the single
source for those values. Both `dev` and `prd` share the same billing account (`01A021-589B0D-8ED8BC`).

| Threshold | Basis |
|---|---|
| 50 % | actual spend |
| 90 % | actual spend |
| 100 % | actual spend |
| 100 % | forecasted spend |

**Do not create a budget by hand** (`gcloud billing budgets create`): the budget is in the Terraform
state, and a second one would send every alert twice. To change an amount, change `budget_amount`
in the `tfvars` through a pull request. Changing or importing a budget requires the
*Billing Account Administrator* (`roles/billing.admin`) or *Billing Account Costs Manager*
(`roles/billing.costsManager`) role on the billing account of the project, which belongs to another
team member. Alert emails go to the billing account's administrators and users.

Standard GCP budgets are notification-only and do not stop resources automatically. When an alert
fires, the team must inspect and downscale running workloads.

## Changing it

- A new variable gets a `description`, a `type`, and a value in both `<env>.tfvars`. Mark a
  variable `sensitive` only if it is a secret: a sensitive value is hidden from the plan that
  reviewers read.
- `.terraform.lock.hcl` is committed and covers `linux_amd64`, `darwin_arm64` and `darwin_amd64`.
  After changing a provider constraint, run `terraform providers lock` for those three platforms
  and commit the result.
- A new stack goes in its own folder under `infra/`, with its own `backends/` and `<env>.tfvars`
  and the prefix of its name.
