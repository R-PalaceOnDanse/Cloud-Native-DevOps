# ADR-0017 — Prometheus and Grafana for the dashboards

- **Status**: Accepted
- **Date**: 2026-11-23
- **Deciders**: project owner; team approval through pull request review
- **Supersedes**: the dashboards part of [ADR-0010](0010-native-gcp-observability.md)

## Context

ADR-0010 chose Cloud Monitoring, Cloud Logging and Cloud Trace, and kept Managed Prometheus for
later, "only if runner activity cannot be seen otherwise". That is now the case: the runner
controller exposes how many jobs wait and how many runners are busy as Prometheus metrics, and
nothing else shows it. The team also wants Grafana, which the subject accepts next to Cloud
Monitoring (C08). PR #153 already added a Cloud Monitoring dashboard and three alerts, but no one is
notified.

## Options considered

1. **Cloud Monitoring only** (ADR-0010) — nothing to run, but no view of the runner activity.
2. **Managed Prometheus and Grafana in the cluster** — Google collects and stores the metrics, we
   only run Grafana. One screen for the cluster, the runners and the functions.
3. **Prometheus and Grafana both in the cluster** (kube-prometheus-stack) — more control, but a
   Prometheus server and its disk on a cluster that is already small.

## Decision

Option 2.

- **Collection**: Managed Prometheus, which GKE already runs. `PodMonitoring` objects select the
  metrics of the runner controller, which are switched on in its Helm values.
- **Grafana**: one replica in the namespace `monitoring`, no disk, no public address (reached with
  `kubectl port-forward`). Its admin password is in Secret Manager and copied by External Secrets
  Operator, as for the runner token ([ADR-0015](0015-secrets-in-secret-manager.md)).
- **Data**: one datasource, Grafana's Google Cloud Monitoring plugin, authenticated by Workload
  Identity with `roles/monitoring.viewer`. It reads the GKE metrics, the Prometheus metrics (PromQL)
  and the serverless metrics.
- **Dashboards** are JSON files in the repository.
- **Alerts** stay Cloud Monitoring alert policies, with email channels: Grafana would need a mail
  server. Their conditions can use PromQL on the Prometheus metrics.
- Cloud Logging and Cloud Trace do not change.
- The system node pool goes from `e2-small` to `e2-medium` in both environments: the small node is
  already full (94% of its memory is requested), and Grafana does not fit on it.

## Consequences

- Positive: the runner activity is visible; one place to look at the cluster and the functions;
  dashboards are code.
- Negative / trade-offs accepted: one more component to run; about 14 USD more per month and per
  environment for the bigger node; alerts and dashboards are in two tools; Grafana is only reachable
  by port-forward, which is enough for the team and the defense.
- To verify in dev first: that the Grafana version we pin runs PromQL queries through the Google Cloud
  Monitoring datasource.
- Follow-up work: the cluster dashboard (#85), the alerts (#87), the application dashboard (#86).
