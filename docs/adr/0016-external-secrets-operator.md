# ADR-0016 — Copy the runner token from Secret Manager with External Secrets Operator

- **Status**: Accepted
- **Date**: 2026-11-12
- **Deciders**: project owner; team approval through pull request review
- **Supersedes**: none

## Context

The runner controller needs a GitHub token as a Kubernetes secret. Passed through Terraform it
ends up in the state (issue #72). By [ADR-0015](0015-secrets-in-secret-manager.md) the token lives
in Secret Manager, so something must copy it into the cluster without Terraform seeing the value.

## Options considered

1. **A secret created by hand with `kubectl`** — nothing to run, but the token is not in Secret
   Manager, and a rebuilt cluster starts without it.
2. **A pipeline step** that reads Secret Manager and applies the secret — no new component, but
   the deploy account needs access to the cluster, and nothing fixes a drift between two releases.
3. **External Secrets Operator (ESO)** — a controller that keeps a Kubernetes secret in step with
   Secret Manager, including after a rotation or a rebuild. One more release to run.

## Decision

Option 3. ESO runs on the system pool and reads the secret as its own Kubernetes service account
through Workload Identity (no Google account, no key), with `secretAccessor` on that one secret.
A small local chart declares the store and the `arc-github` secret to copy.

The secret `arc-github-token` is created in the `access` stack, not in `foundation`, so a destroy
of the foundation keeps its value.

## Consequences

- Positive: the token is in neither the repository, the state nor the Helm values; rotating it is
  a new Secret Manager version; a rebuilt cluster finds its secret by itself.
- Negative / trade-offs accepted: one more operator on a small system node; Workload Identity
  must be enabled on the cluster and its node pools; the `access` stack must be applied before
  `foundation`.
- Follow-up work: a GitHub App instead of a personal token, if the token's owner leaves the team.
