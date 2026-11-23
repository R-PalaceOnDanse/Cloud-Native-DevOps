# ADR-0020 — Load Testing Tool and Scenarios

- **Status**: Accepted
- **Date**: 2026-11-23
- **Deciders**: project owner, team approval through pull request review
- **Supersedes**: none
- **Resolves**: Decision #66 (Part of Epic #115 / Milestone 6)
- **Implemented by**: [tests/load/burst-load.mjs](../tests/load/burst-load.mjs), [docs/load-testing.md](../load-testing.md) (Issue #90)

## Context

Under project specification **C08 §2** and evaluation criteria, the team must demonstrate system scalability during the oral defense:
> *"Show, through your monitoring, that the system scales and stays performant under load. A load test (script or a tool such as Locust) is one option; the brush drawing many pixels at once can also generate the load. What matters is proving it, not the method."*

GitHub Decision **#66** asks:
1. Which tool generates the load that proves scaling?
2. Which scenarios do we run?

### Key Requirements
- Must produce a burst through the API Gateway with valid payloads and correlation IDs.
- Must be repeatable, scriptable, and runnable by any team member, in CI runners (ARC), and locally without complex prerequisites.
- Must not exceed free tier credits or cause budget overruns.
- Must produce measurable signals on Google Cloud Monitoring dashboards (`serverless_app` and `cluster_runners`).

---

## Options Considered

### Option 1: Locust (Python)
- **Pros**: Established distributed load testing tool; nice web UI for graphs; flexible Python scenarios.
- **Cons**: Requires Python runtime, `pip`, and compiling C dependencies in some environments; heavy overhead for self-hosted ephemeral runners; requires running a separate Locust master/worker web process during the oral defense.

### Option 2: k6 (Go / JS)
- **Pros**: High-performance binary; JavaScript scenario authoring; CLI-friendly.
- **Cons**: Requires installing a separate binary (`k6`) not installed by default on developer machines or GitHub runners; requires maintaining external tooling packages outside npm.

### Option 3: Custom Native Node.js Burst Script (`tests/load/burst-load.mjs`)
- **Pros**:
  - Uses the Node.js runtime already pinned in `mise.lock` (v22) and available across all developer machines and ARC runners.
  - Zero external dependencies; runs immediately with `node tests/load/burst-load.mjs`.
  - Natively integrates with the repository's payload formats, UUID generation, correlation IDs (`trace-load-*`), and percentile calculations.
  - Supports `--dry-run` for instant unit/integration testing in CI without needing network access or cloud credentials.
  - Exports a clean JSON report (`tests/load/load-report.json`) for CI artifact archiving.
- **Cons**: Does not provide a live graphical UI on its own (relies on Cloud Monitoring dashboards for visual display).

### Option 4: Frontend Brush Tool Exclusively
- **Pros**: Visual, interactive, and demonstrates end-user experience directly on the canvas.
- **Cons**: Manual; hard to automate in CI pipelines or create repeatable benchmarks; subject to human clicking speed.

---

## Decision

The team adopts a **Hybrid Approach**:
1. **Automated CLI & CI Tooling**: Adopt **Option 3 (Custom Native Node.js Script)** as the official, repeatable load generator ([tests/load/burst-load.mjs](../tests/load/burst-load.mjs)).
2. **Interactive Defense Demonstration**: Complement the CLI script with **Option 4 (Frontend Brush Tool)** during the live presentation so the jury can observe both programmatic bursts and interactive user drawing simultaneously.

### Selected Scenarios

1. **Burst Draw Scenario (Primary)**:
   - 10–20 concurrent worker streams sending 100–500 draw requests (9–16 pixels per request).
   - Generates a burst of 1,000–5,000 pixels within $< 10\text{ seconds}$.
   - Tests API Gateway ingress, Pub/Sub buffer absorption, and worker auto-scaling.
2. **Sustained Flow Scenario**:
   - 5 concurrent worker streams drawing over 60 seconds with 50 ms delay between requests.
   - Tests continuous queue draining and memory stability.
3. **Dry-Run / CI Scenario**:
   - Runs `node tests/load/burst-load.mjs --dry-run -c 5 -n 25` in CI to ensure the load generator never regresses.

---

## Consequences

- **Positive**:
  - Zero friction: any teammate or runner can run `node tests/load/burst-load.mjs` immediately without installing Python, Locust, or k6.
  - Deterministic CI verification with 9 automated tests in [tests/load/burst-load.test.mjs](../tests/load/burst-load.test.mjs).
  - Clear runbook in [docs/load-testing.md](../load-testing.md) mapping directly to Cloud Monitoring dashboards.
  - Fulfills all criteria of Decision #66 and Issue #90.
- **Negative / Trade-offs Accepted**:
  - Does not generate interactive HTML reports natively; this is an intentional design choice, as the project explicitly requires proving scaling via **Google Cloud Monitoring dashboards** ([infra/serverless/dashboards.tf](../../infra/serverless/dashboards.tf)), not third-party reporting tools.
