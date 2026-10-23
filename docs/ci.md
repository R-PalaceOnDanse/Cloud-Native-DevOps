# CI/CD for the infrastructure

The three workflows that check, release and destroy the Terraform of `infra/foundation`, what they
need, how to run them, and what they do **not** protect against. Read by anyone who changes
`infra/` or starts a release.

They are the minimal examples of the subject (C03 sections 6 to 8), **unchanged** except for one
line: the Terraform version (see below). They are meant as a base that the team extends by hand
([What to extend](#what-to-extend)). The reasons are in
[ADR-0013](adr/0013-subject-minimal-pipelines-as-is.md); the identities they use are described in
[infra.md](infra.md#github-actions-authentication).

## The workflows

| File | Starts when | What it does |
|---|---|---|
| `.github/workflows/terraform-ci.yml` | a pull request targets `main` | For `dev` and `prd`: `fmt -check`, `init`, `validate`, `plan` of `infra/foundation` |
| `.github/workflows/terraform-deploy.yml` | a tag `v*` is pushed | For `dev` then `prd` (`max-parallel: 1`): `init`, `apply -auto-approve` of `infra/foundation` |
| `.github/workflows/terraform-destroy.yml` | started by hand, with the environment as input | `init`, `destroy -auto-approve` of `infra/foundation` for that environment |

Each job runs in the GitHub **environment** of the same name (`dev` or `prd`) and authenticates
to Google Cloud without any key: GitHub gives the job a short-lived token, and Google exchanges it
for short-lived credentials (Workload Identity Federation, the `access` stack).

**The one change to the subject's examples.** Each `hashicorp/setup-terraform@v3` step has
`terraform_version: 1.9.8`. Without it the action installs the latest Terraform, which the stack
refuses (`required_version = "~> 1.9.0"`), so every job would fail. Keep this number equal to
`mise.lock`.

## Variables

Two **environment variables**, defined in each GitHub environment (*Settings → Environments →
`dev` or `prd` → Environment variables*). They are not secrets.

| Variable | Content |
|---|---|
| `WIF_PROVIDER` | Full name of the workload identity provider of that environment's project |
| `DEPLOYER_SA` | Email of the service account the jobs impersonate: the `github-apply` account of that project |

They come from the outputs of the access stack, which is where to read them:

```bash
terraform -chdir=infra/access init -reconfigure -backend-config=backends/dev.hcl
terraform -chdir=infra/access output     # workload_identity_provider, apply_service_account
```

Run it again with `backends/prd.hcl` for prd. `WIF_PROVIDER` is `workload_identity_provider` and
`DEPLOYER_SA` is `apply_service_account`. Paste each value without a space before or after, or
the authentication fails.

```bash
gh variable set WIF_PROVIDER --env dev --body "<workload_identity_provider of dev>"
gh variable set DEPLOYER_SA  --env dev --body "<apply_service_account of dev>"
```

## Using them

**A pull request.** Open it against `main`: `terraform-ci` runs for dev and prd by itself. Open the
run and read the `plan` step: it is what a release would change. A plan that wants to destroy or
replace something is what to question in the review.

**A release.** From an up-to-date `main`:

```bash
git checkout main && git pull
git tag -s v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

`terraform-deploy` applies dev, then prd, and does not start prd if dev failed. To repeat a release
that failed halfway, use *Re-run failed jobs* on the run. To release a fix, merge it and push the
next tag; a tag is never moved.

**A destroy.** *Actions → Terraform Destroy → Run workflow*, with the environment (`dev` or `prd`),
or:

```bash
gh workflow run terraform-destroy.yml --ref main -f env=dev
```

It destroys the foundation of that environment. The `access` stack, the state buckets and the
projects stay, so a new tag rebuilds the foundation.

**The same checks before pushing:**

```bash
terraform -chdir=infra/foundation fmt -check
terraform -chdir=infra/foundation init -reconfigure -backend-config=backends/dev.hcl
terraform -chdir=infra/foundation validate
terraform -chdir=infra/foundation plan -var-file=dev.tfvars
```

## Known limits

These follow from using the examples as they are, and from the free GitHub plan. They are listed so
that nobody is surprised, and so that each can be closed when the team extends the workflows.

1. **The pull request plan uses the apply account.** The example has one account (`DEPLOYER_SA`) for
   everything. A workflow pushed on a branch runs with `environment: dev` or `prd` and can therefore
   change the infrastructure, not only plan it. Nothing in the repository settings prevents it: on
   the free plan an environment cannot be restricted to branches.
2. **No reviewer on prd.** The example says to add required reviewers on prd; the free plan does
   not offer it. Whoever can push a tag, or start the destroy, deploys to dev and prd.
3. **A release does not check the tag.** A tag on any commit, even outside `main`, is applied.
4. **The destroy takes free text** for the environment, asks no confirmation and runs from any
   branch.
5. **`access` is not planned** by the pull request workflow, and the plan locks the state, so two
   pull requests can collide.
6. **No tflint, no secret scan, no signed-commit check** in CI. tflint and gitleaks run in the
   pre-commit hook only, which each member must have activated.
7. **The jobs run on GitHub's runners.** Switching to the self-hosted runners is issue #73.

## What to extend

In the order that closes the most risk first: use `github-plan` for the pull request plan and
`github-apply` for release and destroy only; bind the apply account to the branch or tag as well
as the environment (a change to `infra/access`); refuse a tag that is not on `main`; take the
destroy environment from a choice and a typed confirmation; add tflint; plan `access` too; add the
runner switch.

## When something fails

| Message or sign | Meaning | Fix |
|---|---|---|
| `must specify exactly one of "workload_identity_provider" or "credentials_json"` | `WIF_PROVIDER` is empty in that environment | Set it (see above) |
| `Permission 'iam.serviceAccounts.getAccessToken' denied`, or `Unable to acquire impersonated credentials` | `WIF_PROVIDER` and `DEPLOYER_SA` are not of the same project, or have a stray space | Compare them with the access outputs of that environment |
| `Unsupported Terraform Core version` | The Terraform version in the workflow differs from `required_version` | Use the version of `mise.lock` |
| `Error acquiring the state lock` | Another run is applying, or one was killed | Wait; if nobody is running, `terraform force-unlock <id>` after asking the team |
| `already exists` on the first apply | The resource was created by hand and the state does not know it | Import it into the state, then plan again |

## Rebuilding this elsewhere

Create the projects and the state buckets ([infra.md](infra.md#create-a-state-bucket)); put the real
values in `infra/*/<env>.tfvars` and `backends/<env>.hcl`; apply `infra/access` by hand in each
project; create the GitHub environments `dev` and `prd`; set `WIF_PROVIDER` and `DEPLOYER_SA` in
each from the access outputs; open a pull request to see the plan, then push a first tag.
