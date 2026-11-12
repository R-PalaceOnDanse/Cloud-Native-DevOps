# ADR-0014 — Actions Runner Controller for the self-hosted runners

- **Status**: Accepted
- **Date**: 2026-11-12
- **Deciders**: project owner; team approval through pull request review
- **Supersedes**: none

## Context

The subject asks for self-hosted GitHub Actions runners in the cluster, deployed with Helm, that
scale through node autoscaling. This records a choice already made in `infra/foundation`.

## Options considered

1. **Actions Runner Controller, runner scale sets** — the chart GitHub maintains. Runners are
   ephemeral, created when a job waits and removed after it.
2. **A community controller** — the older ARC variants and others. Less tied to GitHub, but they
   are not the supported path and are harder to justify.
3. **Plain runner deployments** — simple at first, but we would write the scaling ourselves.

## Decision

Option 1, charts `gha-runner-scale-set-controller` and `gha-runner-scale-set`, version 0.9.3,
installed by Terraform (`helm-arc.tf`).

Runners are capped at 2 per environment. They run on a dedicated node pool (`runner-pool`, spot
`e2-medium`, 0 to 2 nodes, tainted `runner=true`), so waiting runner pods make the pool grow and
an idle pool shrinks to zero. The system pool stays at one small node.

## Consequences

- Positive: no scaling code of our own, and nodes cost nothing when no job runs.
- Trade-offs: a runner waits a few minutes when the pool starts from zero, and a spot node can be
  taken back while a job runs.
- Known gaps: the GitHub token goes through Terraform, so it sits in the state (issue #72); the
  runner image is `latest`; no job has run on these runners yet (issue #73).
