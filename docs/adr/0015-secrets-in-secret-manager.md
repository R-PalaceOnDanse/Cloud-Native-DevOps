# ADR-0015 — Where each kind of secret lives

- **Status**: Accepted
- **Date**: 2026-11-12
- **Deciders**: project owner; team approval through pull request review
- **Supersedes**: none

## Context

The subject forbids committing a secret, and Terraform writes every value it handles into the
state, `sensitive` or not. The runner token (a GitHub token with the `repo` scope) went through
Terraform and ended up in the state (issue #72). The team needs one clear place per kind of secret.

## Options considered

1. **Everything in Terraform variables, with `sensitive`** — simple, but the values are stored in
   the state and in the CI secrets. Refused: `sensitive` only hides a value from the output.
2. **Secret Manager for runtime secrets, repository variables for pipeline configuration** —
   Terraform creates the secret, a person adds the value, and the code reads it at run time.
3. **A separate vault (HashiCorp Vault, SOPS files)** — more features, one more system to run for a
   team of three. Refused.

## Decision

Option 2.

| Kind | Where | Who adds the value |
|---|---|---|
| Runtime secret (function or runner credential) | Secret Manager, one secret per use | a team member, with `gcloud secrets versions add` |
| Pipeline configuration (provider names, service account emails) | GitHub repository variables | an Owner, from the `access` outputs |
| Secret needed in the cluster | Kubernetes secret synced from Secret Manager (ADR-0016) | nobody, it is synced |

Terraform creates a secret but never its value, and no Terraform variable holds a secret. The
state therefore has no secret to leak, and `sensitive` is not needed. gitleaks scans the whole
history in CI ([ADR-0003](0003-gitleaks-for-secret-scanning.md)).

## Consequences

- Positive: no secret in the repository, the state or the CI secrets; one rule to remember.
- Negative / trade-offs accepted: adding a value is a manual step once per environment; a secret
  that Terraform destroys loses its value, so long-lived ones go in the `access` stack with
  `prevent_destroy`.
- Follow-up work: ADR-0016 for the runner token.
