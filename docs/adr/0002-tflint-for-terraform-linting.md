# ADR-0002 — Lint Terraform with tflint

- **Status**: Accepted
- **Date**: 2026-10-22
- **Deciders**: project owner
- **Supersedes**: none

## Context

The subject requires `terraform fmt -check` and `terraform validate` in the pipelines, and the
team wants clean, readable infrastructure code. Those two checks do not catch invalid machine
types, deprecated syntax, unused variables or missing version constraints.

## Options considered

1. **tflint** — fast, small, reads Terraform only, with rule sets per provider; the Google ruleset
   must be configured. Does not cover security misconfigurations.
2. **Checkov or Trivy config scan** — broader, includes security policies, but heavier, noisier
   and slower for a small codebase.
3. **Only `fmt` and `validate`** — nothing extra to install, but misses the classes of mistakes
   listed above.

## Decision

Install tflint through mise so the whole team has the same version. It is installed now and will
be added to the Terraform CI job and the pre-commit hook in the change that introduces the first
`.tf` files, together with its configuration. A security-focused scanner can be added later by a
new ADR.

## Consequences

- Positive: stricter Terraform with little overhead.
- Negative / trade-offs accepted: one more tool and a config file to maintain; until the first
  Terraform lands, tflint is installed but unused.
- Follow-up work or new ADRs triggered: wiring in CI and in `.githooks/pre-commit`; a possible
  security scanner.
