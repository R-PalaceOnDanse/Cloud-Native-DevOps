# CI/CD for the infrastructure

How the Terraform code is checked, released and destroyed by GitHub Actions: which workflow does
what, with which identity, which variables it needs, how to run it, and how to rebuild it
elsewhere. Read by anyone who changes `infra/` or starts a release.

The choices are in [ADR-0012](adr/0012-terraform-pipelines.md); the identities are in
[ADR-0011](adr/0011-workload-identity-in-the-access-stack.md) and
[infra.md](infra.md#github-actions-authentication). The documentation check is described in
[development.md](development.md).

## The workflows

| Workflow | Starts when | Identity | What it does |
|---|---|---|---|
| `terraform-ci` | a pull request changes `infra/**`, `app/functions/**`, `.tflint.hcl` or one of these workflows | `github-plan`, read-only, **no** GitHub environment | For each stack (`foundation`, `access`, `serverless`): `fmt -check`, `validate`, `tflint`; then `plan` in dev and in prd |
| `terraform-deploy` | a tag `vMAJOR.MINOR.PATCH` is pushed | `github-apply` | Checks the tag is on `main`, applies `foundation` then `serverless` to **dev**, then to **prd** |
| `terraform-destroy` | started by hand (*Run workflow*) | `github-apply` | Destroys `serverless` then `foundation` of one environment, after a confirmation |
| `terraform-run` | called by the two above | `github-apply` | Plans, then applies the saved plan, for the stack it is given. Not started by hand |
| `functions-ci` | a pull request changes `app/functions/**` | none (no cloud access) | `npm ci` and `npm run build` (strict TypeScript) for each function |
| `auth-check` | a pull request changes `infra/access/**` or this workflow, or by hand | both | Proves the keyless authentication behaves as designed (see below) |
| `docs-check` | see [development.md](development.md) | none | Documentation check |

One composite action, `.github/actions/terraform-init`, installs Terraform, authenticates and runs
`terraform init` for one stack and one environment, so the Terraform workflows cannot drift apart.

## Identities and variables

No key is stored in GitHub: each job exchanges a short-lived GitHub token for Google credentials
(Workload Identity Federation). The jobs read six **repository variables**, which are not secrets:

| Variable | Content |
|---|---|
| `GCP_WIF_PROVIDER_DEV`, `GCP_WIF_PROVIDER_PRD` | Full name of the workload identity provider of the project |
| `GCP_PLAN_SA_DEV`, `GCP_PLAN_SA_PRD` | Email of the read-only `github-plan` account |
| `GCP_APPLY_SA_DEV`, `GCP_APPLY_SA_PRD` | Email of the `github-apply` account |

They are repository variables, not environment variables, because the plan job runs **without** a
GitHub environment and a job can only read the variables of its own environment. The values are the
outputs of the access stack, so that is where to get them:

```bash
terraform -chdir=infra/access init -reconfigure -backend-config=backends/dev.hcl
terraform -chdir=infra/access output     # workload_identity_provider, plan_service_account, apply_service_account
```

Run it again with `backends/prd.hcl` for prd, and set each value without a space before or after:

```bash
gh variable set GCP_WIF_PROVIDER_DEV --body "<workload_identity_provider of dev>"
gh variable set GCP_PLAN_SA_DEV --body "<plan_service_account of dev>"
gh variable set GCP_APPLY_SA_DEV --body "<apply_service_account of dev>"
```

If a value is wrong, the authentication step fails with a message from `google-github-actions/auth`
or from Google (see *When something fails*).

## A pull request on the infrastructure

1. Open the pull request. `terraform-ci` runs by itself.
2. `static` must pass for both stacks: formatting, validation and tflint.
3. `plan` runs for each stack in each environment. Open the run, then **Summary**: the text of each
   plan is there. Read it: it is what a release would change. A plan that wants to *destroy* or
   *replace* something is the thing to question in the review.
4. The plan does not lock the state, so two pull requests can plan together. It can show a change
   that another merged pull request already made; re-run it after merging `main`.

To get the same result before pushing:

```bash
terraform -chdir=infra/foundation fmt -check
terraform -chdir=infra/foundation init -backend=false && terraform -chdir=infra/foundation validate
tflint --chdir=infra/foundation --config="$PWD/.tflint.hcl"
terraform -chdir=infra/foundation init -reconfigure -backend-config=backends/dev.hcl
terraform -chdir=infra/foundation plan -var-file=dev.tfvars
```

## Releasing

A release applies what is on `main` to dev, then to prd. From an up-to-date `main`:

```bash
git checkout main && git pull
git tag -s v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

`terraform-deploy` then runs, one release at a time and never cancelled halfway:

1. `check-tag` refuses a tag whose commit is not on `main`.
2. `dev` plans, then applies **that saved plan** to dev. The job is in the GitHub environment `dev`,
   which is what allows it to use the `github-apply` account of dev.
3. `prd` starts only if `dev` succeeded, and does the same in the environment `prd`.

Version numbers follow semantic versioning; a tag is never moved. To repeat a release that failed
halfway, use **Re-run failed jobs** on the run: it replays the same tag. To release a fix, merge it
and push the next tag.

The pipeline applies `foundation` and `serverless`. The `access` stack is the identity the pipeline
runs with, so a pipeline that changed it could lock itself out: it is planned on every pull
request, and applied **by hand** by a project Owner after the pull request is approved
([infra.md](infra.md#github-actions-authentication)).

## Destroying

From the *Actions* tab, workflow `terraform-destroy`, *Run workflow* on `main`, or:

```bash
gh workflow run terraform-destroy.yml --ref main -f environment=dev -f confirm=dev
```

The environment is a choice between `dev` and `prd`, and `confirm` must repeat it exactly. The
workflow refuses to run from another branch. It plans the destruction, shows it in the summary, and
destroys `serverless`, then `foundation`. The `access` stack, the state buckets and the projects
stay, so the pipeline can rebuild: push a new release tag (or use *Re-run all jobs* on the last
successful release) to recreate both. After a destroy nothing of them remains, so nothing of
them is billed.

Tested on prd on 2026-11-06 (run 42195805274, foundation only at that time) and rebuilt by the tag
`v0.2.2`. Not run on dev, by decision of the team.

## Proving the authentication

`auth-check` runs four checks, on every change to `infra/access` and on demand:

| Job | Expected |
|---|---|
| plan account, no environment, dev and prd | works |
| apply account, in its own environment, dev and prd | works |
| apply account, **no** environment, dev and prd | **refused** |
| prd apply account, from a job of the `dev` environment | **refused** |

The last two pass when the credentials are refused: they show that the apply account cannot be
reached by a pull request branch, nor across environments. The refusal comes when the credentials
are first **used**, as `Permission 'iam.serviceAccounts.getAccessToken' denied` (403): the
authentication action only prepares a credentials file and does not call Google, so a check that
looked at that step alone would pass whatever the rules are.

## Limits of the free GitHub plan

The repository is private and belongs to an organization on the free plan, where an environment
cannot require a reviewer or restrict branches, and `main` cannot be protected (issue #25). What
replaces them:

- a release needs a tag on a commit of `main`, and prd waits for dev;
- a destroy needs a typed confirmation and runs from `main` only;
- the apply accounts are tied to the environment of the same name, so a job outside an environment
  cannot use them (proved by `auth-check`).

Anyone who can push a tag or start a workflow can still deploy. That is accepted for a team of
three, and written down here so that it is not a surprise.

## When something fails

| Message or sign | Meaning | Fix |
|---|---|---|
| `must specify exactly one of "workload_identity_provider" or "credentials_json"` | A variable is empty | Set the repository variable (see above) |
| `Unable to acquire impersonated credentials` or a `403` on `iam.serviceAccounts.getAccessToken`, at the first command that uses the credentials | The provider and the account are not of the same project, or the job's environment is not the one the account accepts | Compare the three values with `terraform output` of the access stack for that environment |
| The authentication works but `plan` says `403` on the state bucket | The account lacks access to the state bucket | The access stack grants it; check that it has been applied in that project |
| `Error acquiring the state lock` | Another apply is running, or one was killed | Wait; if nobody is running, `terraform force-unlock <id>` after asking the team |
| `tflint` reports a rule | A real finding | Fix it, or discuss disabling the rule in `.tflint.hcl` in the pull request |
| `check-tag` fails | The tag is not on `main` | Delete the tag, merge the change to `main`, tag again |

## Rebuilding this elsewhere

For another repository or other projects: create the projects and the state buckets
([infra.md](infra.md#create-a-state-bucket)); put the real values in `infra/*/<env>.tfvars` and
`backends/<env>.hcl`; apply `infra/access` by hand in each project; create the GitHub environments
`dev` and `prd`; set the six repository variables from the access outputs; open a pull request to
see `terraform-ci` plan, run `auth-check`, then push a first tag.
