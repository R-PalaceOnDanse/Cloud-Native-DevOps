# ADR-0004 — Terraform layout and environment naming

- **Status**: Accepted
- **Date**: 2026-10-22
- **Deciders**: project owner; team approval through the review of the pull request that adds this ADR
- **Supersedes**: none

## Context

The subject requires human access in a separate Terraform stack, so that destroying the workload
never revokes people's access, and the same code must produce dev and prd (subject §2.2, C02 §5,
C03 §9). Remote state is required, and a backend block cannot use variables.

## Options considered

1. **Three root stacks** — `infra/access`, `infra/foundation`, `infra/serverless`, each with its
   own state, a `backends/{dev,prd}.hcl` and a `{dev,prd}.tfvars` per environment. The layout the
   subject suggests; destroys are isolated. Stacks must pass values to each other explicitly.
2. **One state for everything** — simple, but contradicts the separate access stack and makes a
   destroy dangerous.
3. **Terraform workspaces for dev and prd** — one backend, but the active workspace is invisible
   in the code, and a wrong selection can destroy prd.

## Decision

Option 1. Each stack is a Terraform root with its own state in the environment's GCS bucket
(one bucket per environment, one prefix per stack). Environments are selected with
`-backend-config=backends/<env>.hcl` and `-var-file=<env>.tfvars`; workspaces are not used.
Stacks exchange values through input variables or `data` sources, not `terraform_remote_state`,
to keep them decoupled. A local module is created only for something that is really repeated, for
example "a function": service account, function and IAM bindings.

Naming: GCP projects are `<team>-cloudnative-dev` and `<team>-cloudnative-prd`; state buckets are
`<team>-<env>-tfstate`. `<team>` is still to be fixed (see `CLAUDE.md`, open questions).

## Consequences

- Positive: a destroy of the foundation or the app leaves the access stack alone; reviewers see
  one environment's plan per state; the layout matches the subject.
- Negative / trade-offs accepted: three pipelines' worth of `init`/`plan`/`apply` to orchestrate;
  values shared between stacks are passed by hand.
- Follow-up work: issue #27 implements the layout; the layout is described in
  `docs/architecture.md` when the folders exist.
