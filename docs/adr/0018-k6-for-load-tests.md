# ADR-0018 — k6 for the load tests

- **Status**: Accepted
- **Date**: 2026-11-23
- **Deciders**: project owner; team approval through pull request review
- **Supersedes**: none

## Context

The defense must show the application scaling under load, read on the dashboards (issue #66). The
tool has to send a burst through the API Gateway with its API key, be repeatable and scriptable, cost
nothing worth counting, and run from any laptop or from a pipeline. The runner scaling already has its
own test (issue #75): a workflow whose jobs only hold a runner. This decision is about the load on the
API.

## Options considered

1. **Locust** (Python) — a web page to start and watch a run is nice for a demo, but every machine needs
   Python and its dependencies.
2. **k6** (JavaScript) — one binary, a script with stages and thresholds, a clear summary at the end.
3. **A script of our own** in TypeScript — reuses the repository's tools, but we would write the
   bursts, the limits and the report ourselves.
4. **The brush of the frontend** as the source — it does not exist yet. It can become a scenario later.

## Decision

Option 2. k6 is installed by mise like the other tools, so everyone has the same version. A script in
the repository sends the burst through the gateway with the API key. Thresholds on the error rate
make the run fail when the service does not hold. It runs from a laptop, or from a workflow started by
hand.

## Consequences

- Positive: nothing to install beyond mise; a run is one command and gives a pass or a fail.
- Negative / trade-offs accepted: scripts are JavaScript, not TypeScript. The ceiling of the demo is
  set by the function's `max_instances` (3), which is also the cost safeguard.
- Follow-up work: the script and its runbook (#90); a scenario through Pub/Sub once the queue exists
  (#45).
