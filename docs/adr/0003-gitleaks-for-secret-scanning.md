# ADR-0003 — Scan commits for secrets with gitleaks

- **Status**: Accepted
- **Date**: 2026-10-22
- **Deciders**: project owner
- **Supersedes**: none

## Context

The subject forbids committing any secret, and `CLAUDE.md` rule 5 repeats it. Cloud keys, Discord
tokens and signing keys are all plausible accidents in this project, and a committed secret
stays in git history. The check must run locally before the commit, not only in review.

## Options considered

1. **gitleaks** — a single static binary, scans staged changes in milliseconds, has a
   pre-commit mode, and its default rules cover common cloud and API keys. It can produce false
   positives that need an allowlist.
2. **TruffleHog** — more detectors and secret verification against live services, but heavier
   and slower, and verification calls out to external services.
3. **GitHub secret scanning only** — no local install, but it flags secrets after the push, when
   they are already in the history.

## Decision

Run gitleaks on staged changes in `.githooks/pre-commit`, installed through mise. GitHub secret
scanning can be enabled on the repository in addition, since it costs nothing.

## Consequences

- Positive: secrets are stopped before they enter history.
- Negative / trade-offs accepted: a false positive blocks a commit until an allowlist entry is
  added; the hook only protects clones where the hooks are active, which `CLAUDE.md` rule 9
  requires.
- Follow-up work or new ADRs triggered: a CI scan of the full history if hooks prove unreliable.
