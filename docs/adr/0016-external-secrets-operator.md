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

Option 3. ESO runs on the system pool and reads the secrets as its own Kubernetes service account
through Workload Identity (no Google account, no key), with `secretAccessor` on the runner secrets.
A small local chart declares the store and the `arc-github` secret to copy.

The runner credentials are created in the `access` stack, not in `foundation`, so a destroy
of the foundation keeps their values.

### GitHub App Authentication Update (Issue #151)

Initially, ARC authenticated via a fine-grained Personal Access Token (`arc-github-token`). To eliminate reliance on an individual's personal account and token expiration risks, authentication has been migrated to an **organization-owned GitHub App**:

1. **Organization-Level Identity**: The GitHub App is owned by the organization and installed exclusively on `R-PalaceOnDanse/Cloud-Native-DevOps` with minimal required scopes (`Actions: Read & write`, `Administration: Read & write`, `Checks: Read`).
2. **Secret Manager Storage**: Three secrets live in Secret Manager with `prevent_destroy = true`:
   - `arc-github-app-id`: numeric GitHub App ID.
   - `arc-github-app-installation-id`: numeric installation ID for the repository.
   - `arc-github-app-private-key`: PEM private key generated for the App.
3. **ESO Synchronization**: The `arc-secret` chart reads these secrets and populates the Kubernetes secret `arc-github` with keys `github_app_id`, `github_app_installation_id`, and `github_app_private_key`. The `gha-runner-scale-set` controller automatically authenticates using these GitHub App credentials.
4. **Token Deprecation**: The legacy personal token is revoked and its Secret Manager version destroyed once the app is active.

## Consequences

- Positive: no credentials appear in the repository, the Terraform state, or Helm values; rotating the private key requires only a new Secret Manager version without restarting the cluster; rebuilt clusters resolve secrets automatically; runner authentication does not depend on an individual's GitHub account.
- Negative / trade-offs accepted: one more operator on a small system node; Workload Identity must be enabled on the cluster and its node pools; the `access` stack must be applied before `foundation`.
- Follow-up work: private key rotation is documented in [docs/infra.md](../infra.md#runner-authentication-github-app).
