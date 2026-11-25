# ADR-0019 — Worker Admin Authorization: Role ID and Allow-List Check

- **Status**: Accepted
- **Date**: 2026-11-23
- **Deciders**: project owner, team approval through pull request review
- **Supersedes**: none
- **Resolves**: Issue #68 (Part of Epic #122 / Milestone 4)

## Context

The Discord bot and backend worker process commands such as `/admin pause`, `/admin resume`, `/admin clear`, `/admin ratelimit`, and `/snapshot`. Under the project requirements (`project_steps.pdf` C07 §1.1 & §1.2), admin authorization must be strictly enforced: normal users must never be allowed to execute administrative actions or trigger snapshots.

Issue #68 requires determining how the worker validates whether an interacting user is authorized to perform admin commands:
- The check must happen **in the worker**, never solely relying on Discord client-side command permissions.
- It must be dynamically changeable without redeploying code.
- It must survive the original server owner leaving or transferring ownership.
- It must evaluate `roleIds` carried in the event payload.
- It must be explainable during the oral defense.

## Options considered

1. **Discord Role ID only** (`ADMIN_ROLE_ID`):
   - The worker checks if any role ID in `member.roles` matches a configured environment variable or Secret Manager role ID.
   - *Limitation*: If the server owner leaves, or if team members/evaluators need admin permissions without being assigned that specific Discord role, code or server reconfiguration is required.
2. **Static user ID allow-list in code or environment variables** (`ADMIN_USER_IDS`):
   - Only explicitly listed Discord user IDs are permitted.
   - *Limitation*: Rigid; adding a new administrator or TA requires updating environment variables or committing code.
3. **Hybrid: Dual Role ID check with Firestore dynamic allow-list and fallback environment list**:
   - The worker checks whether:
     a. Any ID in `member.roles` matches the configured `ADMIN_ROLE_ID`.
     b. OR the user ID matches `ADMIN_USER_IDS` environment variable.
     c. OR the user ID is present in the `config/admins` document (`userIds: string[]`) in Firestore.

## Decision

Option 3: **Hybrid Authorization (Discord Role ID + Firestore Allow-List + Environment Allow-List)**.

- **Worker-Side Enforcement**: The authorization check executes synchronously inside the worker before any state mutation or bucket write occurs. If unauthorized, the worker immediately rejects the interaction with an ephemeral response (`⛔ Action réservée aux administrateurs.`).
- **Zero-Downtime Governance**: Team members can grant or revoke admin access dynamically by updating `config/admins` in Firestore, without redeploying any Cloud Functions.
- **Resilience**: The environment variable `ADMIN_USER_IDS` provides a bootstrap/break-glass mechanism for core project owners even if Firestore config is unset.
- **Defense Alignment**: During the oral defense, evaluators can be instantly granted admin privileges either by assigning them the Discord Admin role or by adding their snowflake ID to `config/admins`.

## Consequences

- Positive:
  - Strong security: impossible for a malicious user to bypass admin checks by forging requests or spoofing client flags.
  - High operational agility: instant admin delegation without CI/CD redeployments.
  - Fulfills acceptance criteria of #57, #56, #68.
- Negative / trade-offs accepted:
  - Checking `config/admins` requires reading a single Firestore document when a non-role user executes an admin command; cached in-memory with a short TTL (60s) to keep latency under 10 ms.
