# ADR-0013 — Use the subject's minimal pipelines as they are

- **Status**: Accepted
- **Date**: 2026-10-23
- **Deciders**: project owner; team approval through the review of the pull request that adds this ADR
- **Supersedes**: ADR-0012

## Context

The subject gives three minimal GitHub Actions workflows (C03 sections 6 to 8): check and plan on
pull requests, apply on tags, manual destroy. It says that they are intentionally minimal and to
extend them. [ADR-0012](0012-terraform-pipelines.md) replaced them with a larger design: a shared
composite action, a reusable workflow, repository variables, a read-only plan account, a release
that checks the tag, a destroy with a confirmation, and a workflow that tests the authentication.
It was merged, then judged too far from what the subject asks and too much to defend as a first
step.

## Options considered

1. **Keep the ADR-0012 design** — stricter, but five workflows, one action and six variables where
   the subject shows three workflows and two variables, with every difference to explain.
2. **The subject's examples as they are** — exactly what a reader of the subject expects, three
   short files that every member can read in one minute; the weaknesses of the examples stay until
   the team removes them.
3. **The examples with the safety additions folded in at once** — a mix that is neither the
   subject's shape nor a design of our own.

## Decision

Option 2. The three workflows are the subject's examples, copied unchanged, with one forced change:
`terraform_version: 1.9.8` on `hashicorp/setup-terraform`, because the stack requires Terraform
1.9.x and the action installs the latest one by default. They read two environment variables of each
GitHub environment, as in the examples: `WIF_PROVIDER` and `DEPLOYER_SA`, the latter being the
`github-apply` account of the project.

The additions of ADR-0012 are not lost: [ci.md](../ci.md) lists the limits of the examples and the
order in which the team extends them by hand.

## Consequences

- Positive: the pipeline matches the subject and is easy to explain; fewer moving parts; a first
  release is possible without waiting for the extensions.
- Negative / trade-offs accepted: the pull request plan runs with the apply account, so a branch
  can change infrastructure; nobody must approve a release to prd; a tag outside `main` is applied;
  the destroy has no confirmation. These are listed in `ci.md`, and they are the first things to
  extend.
- The `github-plan` account and `infra/access` are unchanged; `github-plan` is not used by any
  workflow until the extensions use it.
- The workflow that tested the authentication (`auth-check`) is removed with the rest. Its result
  stays true: the apply account of an environment can be impersonated by a job that declares that
  environment, including from a pull request branch.
