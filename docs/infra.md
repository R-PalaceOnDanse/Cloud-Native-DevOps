# Infrastructure

How the Terraform code under `infra/` is organised, where each environment's values live, and how
to run it. Read by anyone who plans or changes cloud resources.

The decisions behind this layout are in [ADR-0004](adr/0004-terraform-layout-and-environments.md).
Two stacks exist:

- `foundation`: the network of each environment (a VPC and one subnet). The cluster and the
  runners are added by the section 2 issues.
- `access`: how GitHub Actions authenticates to Google Cloud without a key (Workload Identity
  Federation), described [below](#github-actions-authentication). The human access to the projects
  is added to this stack by issue #28.

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

`<stack>` is `foundation` or `access`, and `<env>` is `dev` or `prd`. Both environments run the same code; only `backends/<env>.hcl` and
`<env>.tfvars` differ. These two files are the single source of truth for the project IDs, the
region, the network names and ranges, and the state buckets: read them rather than copying their
values elsewhere. None of them is a secret, so they are committed.

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
- **Apply and destroy** are done by the pipeline, once it exists (issues #32 and #33). Until then,
  agree in the team before running `apply` or `destroy`: they change real resources and spend
  credits.

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

A workflow reads the three values it needs from the stack's outputs (`workload_identity_provider`,
`plan_service_account`, `apply_service_account`) and passes them to `google-github-actions/auth`
with `id-token: write` permission. The pipelines that do so are issues #31 to #33.

The first `apply` of this stack is done by hand with the Google login of a project Owner, because
the pipeline cannot authenticate before this stack exists. After that, changes to it go through a
pull request like any other.

`state_bucket` in `<env>.tfvars` repeats the bucket of `backends/<env>.hcl`, as Terraform cannot
read its own backend configuration: change both together.

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

To prevent accidental credit burns from autoscaling or resource misconfigurations, both projects
have a monthly budget alert configured on their respective billing accounts.

| Environment | Project | Billing Account | Monthly Budget | Alert Thresholds | Recipients |
|---|---|---|---|---|---|
| **dev** | `teampasx-cloudnative-dev` | `015B95-C1627B-339E15` | 20 EUR | 50%, 90%, 100% (actual), 100% (forecasted) | All team members (Billing Account Admin & Users) |
| **prd** | `teampasx-cloudnative-prd` | `01A021-589B0D-8ED8BC` | 20 EUR | 50%, 90%, 100% (actual), 100% (forecasted) | All team members (Billing Account Admin & Users) |

### Creating or updating budget alerts

Budget alerts are created per billing account, filtered to the target project:

```bash
gcloud billing budgets create --billing-account=<BILLING_ACCOUNT_ID> \
  --display-name=teampasx-cloudnative-<env> \
  --budget-amount=20EUR \
  --filter-projects=projects/teampasx-cloudnative-<env> \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0 \
  --threshold-rule=percent=1.0,basis=forecasted-spend
```

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
