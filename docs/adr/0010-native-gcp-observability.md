# ADR-0010 — Native GCP observability with OpenTelemetry

- **Status**: Accepted
- **Date**: 2026-10-22
- **Deciders**: project owner; team approval through the review of the pull request that adds this ADR
- **Supersedes**: none

## Context

Metrics, logs and traces are needed for the cluster and runners and for the serverless
application, with alerts and a correlation ID across services, and scaling must be demonstrated
(subject §4, C08). C08 suggests cloud-native monitoring for the serverless side and accepts
either managed Prometheus with Grafana or Cloud Monitoring for the cluster.

## Options considered

1. **Native GCP**: Cloud Monitoring, Cloud Logging and Cloud Trace, instrumented with
   OpenTelemetry — no server to run, and function, Pub/Sub and Firestore metrics are available
   without extra work.
2. **Prometheus and Grafana in the cluster** — rich dashboards, but they run on the same small
   cluster they observe, and the serverless side needs an exporter.
3. **A mix of both** — more tools to justify at the defense.

## Decision

Option 1. Dashboards and alert policies are defined in Terraform. Managed Service for Prometheus
is added only if runner activity cannot be seen otherwise; its ingestion is billed per sample.

Correlation: the proxy creates a `correlation_id` for each request, stores it in the Pub/Sub
message attributes and in every JSON log line, and the W3C trace context travels with it so logs
and traces link together. Alerts cover at least one resource metric (node pressure or runner jobs
stuck pending) and one application metric (error rate, queue age or dead-letter count). Email is
the first notification channel; a Discord channel through a Pub/Sub-triggered function can follow.

## Consequences

- Positive: one tool family, deployable as code, easy to explain.
- Negative / trade-offs accepted: tied to GCP; Cloud Monitoring has no native Discord channel.
- To verify during implementation: how runner (Actions Runner Controller) metrics reach Cloud
  Monitoring, and whether the load test fits within the free quotas.
- Follow-up work: the correlation ID name and format become part of the events documentation
  (`docs/events.md`) when the first event exists.
