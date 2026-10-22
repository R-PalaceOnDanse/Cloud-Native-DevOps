# ADR-0001 — Pin local tooling with mise

- **Status**: Accepted
- **Date**: 2026-10-22
- **Deciders**: project owner
- **Supersedes**: none

## Context

Three people work on Terraform, Helm, GKE and serverless code. Each needs the same versions of
Terraform, gcloud, kubectl, Helm and Node, installable with little effort, and the CI must be
able to use the same versions later. Team members work on Linux, macOS or WSL2.

## Options considered

1. **mise (`.mise.toml`)** — one file pins every tool, one command installs them, and CI can reuse
   it. Each person installs mise; gcloud integration is less smooth than the official package.
2. **Docker or devcontainer only** — reproducible, but gcloud and kubectl credentials must be
   mounted, file permissions and paths get awkward, and everyday terminals become heavier.
3. **Nix** — maximal reproducibility, but a steep learning curve for a three-person, short project.
4. **Makefile or install script** — simple, but versions drift between machines because nothing
   pins them.

## Decision

Use mise as the single source of tool versions, with `mise run setup` as the one setup command.
A devcontainer built on the same `.mise.toml` may be added later if a teammate prefers to install
nothing. Pre-commit hooks run `terraform fmt` and `gitleaks` to enforce formatting and the
no-secrets rule.

## Consequences

- Positive: identical tool versions locally and, later, in CI; a short onboarding.
- Negative / trade-offs accepted: everyone installs mise; versions are prefixes until a lockfile
  is committed.
- Follow-up work or new ADRs triggered: the function runtime (language) is a separate decision;
  CI will use `jdx/mise-action` when the first pipeline is written.
