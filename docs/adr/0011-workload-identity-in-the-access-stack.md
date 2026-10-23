# ADR-0011 — Workload Identity Federation in the access stack, with separate plan and apply identities

- **Status**: Accepted
- **Date**: 2026-10-23
- **Deciders**: project owner; team approval through the review of the pull request that adds this ADR
- **Supersedes**: none

## Context

The pipelines must authenticate to GCP with short-lived credentials, scoped to the repository and
the environment, and no long-lived key may be stored in GitHub (subject §2.1, C03 §4). The
pipelines also run the manual destroy of the foundation (issue #33), and plans run on every pull
request, including from branches.

## Options considered

1. **Pool, provider and one service account in the `foundation` stack** — one stack to read, but a
   destroy of the foundation would delete the identity the pipeline needs to run, so no later
   workflow could authenticate.
2. **Pool and provider in the `access` stack, with a single service account for plan and apply** —
   survives a destroy, but a plan on any pull request would run with the rights to change
   resources.
3. **Pool and provider in the `access` stack, with a read-only identity for plans and a separate
   identity for apply and destroy** — survives a destroy, and only a job in the matching GitHub
   environment gets write rights.

## Decision

Option 3, in every project (dev and prd).

- The provider trusts GitHub's OIDC issuer and carries an attribute condition that refuses any
  token whose repository is not this one.
- `github-plan` has Viewer and Security Reviewer (so that a plan can read IAM policies) on the
  project and may be impersonated by any workflow of the repository.
- `github-apply` has Editor and Project IAM Admin on the project and may be impersonated only by
  jobs whose OIDC token carries the GitHub environment named like the Terraform environment.
- Both accounts get `roles/storage.objectAdmin` on the state bucket, since Terraform writes a lock
  object even for a plan.

## Consequences

- Positive: no key in GitHub; a destroy of the foundation cannot cut the pipeline off; a pull
  request from a branch can plan but cannot change anything; prd cannot be applied by a job that
  does not run in the `prd` environment.
- Negative / trade-offs accepted: `github-apply` is broad (Editor plus Project IAM Admin). It is
  narrowed once the stacks that really need specific roles exist. The first apply of the stack is
  done by hand, since the pipeline cannot authenticate before it exists.
- To verify with the first real plan: that the Viewer and Security Reviewer roles are enough for
  the plans of every stack, and that GitHub's OIDC token carries the environment claim for jobs
  that use a GitHub environment.
- Follow-up work: the pipelines of issues #31 to #33 use the three outputs; the human access of
  issue #28 is added to this stack; `docs/infra.md` describes the stack.
