# Observability: Dashboards, Alerts & Metrics (Milestone 6)

This document describes the observability stack covering both the Kubernetes runner cluster and the event-driven serverless application, fulfilling GitHub Issues **#85**, **#86**, and **#87** (C08 §1–§3).

---

## 1. Application Dashboard (Issue #86)

The application dashboard (`infra/serverless/dashboards.tf`) provides real-time visibility into the health and performance of the serverless pixel canvas pipeline.

### Monitored Metrics
1. **Cloud Functions Invocations**: Rate of incoming requests (requests/sec) grouped by Cloud Run function (`web-draw-proxy`, `draw-worker`, `auth-callback`).
2. **Cloud Functions 5xx Errors**: Real-time error rate grouped by service.
3. **Execution Latency**: 95th percentile execution duration (ms) across all functions.
4. **Pub/Sub Queue Depth**: Number of unacknowledged messages pending processing in `pixel-draw-events` / `draw-worker-sub`.
5. **Oldest Unacknowledged Message Age**: Age in seconds of the oldest message waiting in the worker subscription queue.
6. **Dead-Letter Queue (DLQ) Activity**: Rate of poison pill messages pushed to `pixel-draw-events-dlq`.

---

## 2. Cluster & Runners Dashboard (Issue #85)

The cluster dashboard (`infra/foundation/dashboard_cluster.tf`) provides operators with immediate insight into GKE cluster resource allocation and GitHub Actions runner autoscaling.

### Monitored Metrics
1. **GKE Node Count by Pool**: Tracks horizontal node autoscaling between the fixed `default-pool` (system pods) and the dynamic `runner-pool` (0 to 5 nodes).
2. **ARC Runner Pod Activity**: Number of active running and pending runner pods in namespace `arc-runners`.
3. **CPU Utilization**: CPU cores allocated and used across namespaces (`arc-runners`, `kube-system`).
4. **Memory Working Set**: RAM consumption across namespaces.

---

## 3. Real-Time Alert Policies & Notification Channel (Issue #87)

Alert policies are provisioned via Terraform in `infra/serverless/alerts.tf` and deliver notifications via email (`quaduval@gmail.com`).

| Alert Policy | Threshold | Evaluated Metric | Action Required |
|---|---|---|---|
| **High Function 5xx Error Rate** | Error rate > 5% over 60s | `run.googleapis.com/request_count` (5xx) | Inspect error logs filtered by `severity>=ERROR` in Cloud Logging. |
| **Dead-Letter Queue (DLQ) Messages** | Message count > 0 | `pubsub.googleapis.com/topic/send_request_count` on DLQ | Inspect poison pill payload in DLQ subscription and review worker exception traces. |
| **Draw Queue Backlog Age** | Oldest message age > 60s | `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Check worker concurrency, instance scaling limits, or Firestore rate-limit bottlenecks. |

### Testing & Validation Runbook
To verify alert triggers during testing:
1. **Trigger DLQ Alert**: Publish a malformed JSON payload directly to `pixel-draw-events`. After 5 failed delivery attempts, the message moves to DLQ, triggering the notification.
2. **Trigger 5xx Error Alert**: Send rapid requests to a function with an invalid configuration.
3. **Trigger Backlog Alert**: Run the burst load test (`tests/load/`) while worker max instances are constrained.
