# ADR-0012 — Terraform pipelines: plan on pull requests, release on tags, guarded destroy

- **Status**: Superseded by ADR-0013
- **Date**: 2026-10-23
- **Deciders**: project owner; team approval through the review of the pull request that adds this ADR
- **Supersedes**: none

## Context

The subject asks for `fmt` and `validate`, a plan for dev and prd on every pull request, an apply
on a release tag to dev then prd through GitHub Actions environments, and manual destroy
workflows. The repository is private on a free organization plan, where an environment cannot
require a reviewer or restrict branches and `main` cannot be protected. The pipeline authenticates
with the identities of [ADR-0011](0011-workload-identity-in-the-access-stack.md).

## Options considered

1. **One workflow with a matrix for everything** — short, but plan, apply and destroy would share
   one set of permissions and one trigger, and a mistake in a condition could apply from a pull
   request.
2. **Plan jobs in the GitHub environments too** — the environment variables become readable, but
   every plan creates a deployment record and the plan would run with the environment's claims for
   nothing.
3. **Separate workflows by purpose, sharing one reusable workflow and one composite action** — each
   trigger has the identity it needs and no more; the apply and destroy code path is the same.

## Decision

Option 3.

- **`terraform-ci`** runs on pull requests, as the read-only account, in no environment. It runs
  `fmt`, `validate` and tflint per stack, then `plan` per stack and environment with
  `-lock=false`, because a plan only reads and two pull requests must be able to plan together. The
  plan is shown in the job summary.
- Because the plan job has no environment, it cannot read environment variables: the six values
  (provider, plan account, apply account, for each environment) are **repository variables**. They
  are not secrets.
- **`terraform-deploy`** runs on a tag `vMAJOR.MINOR.PATCH`. It first refuses a tag whose commit is
  not on `main`, then applies to dev, then to prd, chained with `needs`; a matrix would not
  guarantee the order. One release at a time, never cancelled.
- **`terraform-destroy`** is started by hand, takes the environment as a choice and a confirmation
  that repeats it, and refuses any ref but `main`.
- **`terraform-run`** is the reusable workflow both call. It plans, saves the plan and applies that
  saved plan, so what is applied is what was shown. The job declares the GitHub environment, which
  is what lets it use the apply account.
- The pipeline applies and destroys **`foundation` only**. The `access` stack is the identity the
  pipeline runs with; it is planned on every pull request and applied by hand by a project Owner.
- **`auth-check`** proves the authentication rules, including that two forbidden cases are refused.

## Consequences

- Positive: a pull request can read but never change; a release is a tag; the order dev then prd is
  explicit; a destroy needs a typed confirmation; the guarantees are tested by a workflow.
- Negative / trade-offs accepted: on the free plan, anyone who can push a tag or start a workflow
  can deploy, since no reviewer can be required. The access stack is still applied by hand, and
  pull request plans can show a change that another pull request has already made.
- Follow-up work: running these jobs on the self-hosted runners and switching between them
  (issue #73); posting the plan as a pull request comment if the summary proves too hidden; the
  serverless stack joins the matrix when it exists.
