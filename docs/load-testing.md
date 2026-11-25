# Load Testing Runbook: Proving Serverless & Event Scalability (Issue #90)

This runbook describes how to execute, monitor, and interpret load tests against the collaborative pixel canvas platform. It fulfills GitHub Issue **#90**, satisfies **Decision #66 ([ADR-0020](adr/0020-load-testing-tool-and-scenarios.md))**, and provides the practical protocol to demonstrate system scalability during the oral defense (**C08 §2**).

---

## 1. Objectives & Architectural Context

Under load, the system relies on an asynchronous event-driven pipeline:
```
[Load Generator / Brush]
           │
           ▼
    [API Gateway] ──(403 if unauthenticated)
           │
           ▼
  [Web Draw Proxy] ──(Validation & Immediate 202 Accepted)
           │
           ▼
[Cloud Pub/Sub Topic] ──(Queues burst, absorbs spikes)
           │
     ┌─────┴────────────────┐
     ▼                      ▼
[Draw Worker]       [Dead-Letter Queue]
  (Autoscales)        (0 messages in healthy state)
     │
     ▼
[Firestore Chunks] ──(LWW & Batched Deltas)
     │
     ▼
[Frontend Listeners] ──(onSnapshot zero-polling rendering)
```

The load test proves three critical scalability guarantees:
1. **Frontend / Gateway Ingress Stability**: The Web Draw Proxy scales horizontally on Cloud Run, acknowledging incoming requests in $< 100\text{ ms}$ with HTTP `202 Accepted`.
2. **Buffer Absorption**: Cloud Pub/Sub buffers hundreds to thousands of draw operations without dropped messages, shielding Firestore from write concurrency spikes.
3. **Elastic Worker Draining**: The Draw Worker scales out subscriber instances, drains the queue, updates the $64\times 64$ chunk documents using Last-Write-Wins (LWW), and keeps the Dead-Letter Queue (DLQ) at **0**.

---

## 2. Load Testing Tooling: `tests/load/burst-load.mjs`

The load generator is a native, zero-dependency Node.js tool located at [tests/load/burst-load.mjs](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/tests/load/burst-load.mjs).

### Command-Line Arguments

| Flag | Default | Description |
|---|:---:|---|
| `--url`, `--target-url` | `$GATEWAY_URL` or `http://localhost:8080/api/draw` | Target API Gateway or proxy draw endpoint |
| `-c`, `--concurrency` | `10` | Number of concurrent virtual worker streams |
| `-n`, `--requests` | `100` | Total number of requests to execute |
| `-d`, `--duration` | `undefined` | Optional test duration limit in seconds |
| `-b`, `--burst-size` | `9` (3×3 brush) | Number of pixels per request payload (clamped to 1–20) |
| `--delay` | `20` ms | Delay between consecutive requests per worker stream |
| `--token` | `undefined` | Bearer token for authenticated gateway testing |
| `--dry-run` | `false` | Runs locally with simulated network latency and mock responses |
| `-o`, `--output` | `tests/load/load-report.json` | Path to export detailed metrics JSON summary |

---

## 3. How to Run the Load Test

### Scenario A: Local Dry-Run / CI Verification
Run without external cloud resources to verify concurrency scheduling and report generation:
```bash
node tests/load/burst-load.mjs --dry-run -c 10 -n 100 -b 9
```

### Scenario B: Local Full Pipeline (with local emulator or proxy)
```bash
# In terminal 1: run local proxy/worker
npm start --prefix app/functions/web-draw-proxy

# In terminal 2: run burst test
node tests/load/burst-load.mjs --url http://localhost:8080/api/draw -c 10 -n 200 -b 9
```

### Scenario C: Cloud Target (GCP Dev or Prd Gateway)
```bash
# Retrieve Gateway URL from Terraform outputs
cd infra/serverless
GATEWAY_URL=$(terraform output -raw gateway_url)

# Execute 500 requests across 20 concurrent streams (4,500 pixels total)
node ../../tests/load/burst-load.mjs \
  --url "${GATEWAY_URL}/draw" \
  --token "$TEST_AUTH_TOKEN" \
  -c 20 \
  -n 500 \
  -b 9 \
  --output tests/load/cloud-burst-report.json
```

---

## 4. What to Watch on Dashboards

During and immediately following the test run, open the **Google Cloud Monitoring Dashboards** deployed via Terraform:

### 1. Serverless Application Dashboard (`serverless_app`)
Defined in [infra/serverless/dashboards.tf](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/infra/serverless/dashboards.tf):

| Widget Title | Metric Monitored | What to Observe |
|---|---|---|
| **Cloud Run Invocations** | `run.googleapis.com/request_count` | Sharp spike in requests matching the test concurrency |
| **Active Container Instances** | `run.googleapis.com/container/instance_count` | Scale-up of `web-draw-proxy` and `draw-worker` instances |
| **5xx Error Rate** | Error count vs request count | Must remain at **0%** (no unhandled exceptions) |
| **p95 Latency** | `run.googleapis.com/request_latencies` | Proxy latency remains $< 150\text{ ms}$ (since it only buffers to Pub/Sub) |
| **Pub/Sub Queue Depth** | `pubsub.googleapis.com/subscription/num_undelivered_messages` | Rises sharply during the burst, then drains smoothly to 0 |
| **Oldest Unacked Message Age** | `pubsub.googleapis.com/subscription/oldest_unacked_message_age` | Remains low ($< 30\text{ s}$), demonstrating fast consumption |
| **Dead-Letter Queue (DLQ)** | Messages in `pixel-draw-events-dlq` | **Strictly 0**. Any count $> 0$ indicates poisoned messages |

### 2. Cluster & Runners Dashboards
The Cloud Monitoring dashboard of [infra/foundation/monitoring.tf](../infra/foundation/monitoring.tf) and the Grafana
dashboard [infra/foundation/dashboards/cluster.json](../infra/foundation/dashboards/cluster.json) (ADR-0021):
- **Node Count**: Verify the cluster node pool scales up if running concurrent CI runner jobs.
- **ARC Runner Pods**: Verify runner pods scale up dynamically from 0 to target under CI load.

---

## 5. What a Healthy Result Looks Like

A successful and healthy load test displays the following characteristics:

```
===============================================================
       SERVERLESS BURST LOAD TEST REPORT (Issue #90)
===============================================================
Mode:                 LIVE (Cloud Run Gateway)
Target URL:           https://canvas-gw-xxx.gateway.dev/api/draw
Concurrency:          20 concurrent streams
Burst Size:           9 pixels / stroke
Total Requests:       500
Successful (202):     500 (100%)
Rate Limited (429):   0
Failed / Errors:      0
Total Pixels Drawn:   4500 px
Total Duration:       5.82 s
Throughput (Reqs):    85.91 req/s
Throughput (Pixels):  773.19 pixels/s

--- Latency Percentiles (ms) ---
  Min:  32.10 ms
  p50:  68.45 ms
  p90:  112.30 ms
  p95:  134.12 ms
  p99:  178.60 ms
  Max:  210.40 ms
  Avg:  74.20 ms

--- Sample Correlation IDs (for Cloud Logging tracing) ---
  - trace-load-1795442541445-9f67f55c
  - trace-load-1795442541445-dd53c1de
===============================================================
```

### Healthy Criteria Checklist
- [x] **Success Rate**: $\ge 98\%$ HTTP 202 Accepted.
- [x] **Proxy Latency**: p95 $< 250\text{ ms}$.
- [x] **Queue Draining**: Pub/Sub queue backlog returns to 0 within 60 seconds of test completion.
- [x] **Zero DLQ**: No messages routed to `pixel-draw-events-dlq`.
- [x] **No Ghost Pixels**: Firestore chunk documents contain valid pixel arrays, and all connected web frontends update via `onSnapshot` without requiring a browser refresh.

---

## 6. Failure Modes & Remediation

| Symptom | Probable Cause | Action / Runbook |
|---|---|---|
| **HTTP 429 Too Many Requests** | Token bucket exhausted for single user | Expected behavior if 1 user exceeds 20 tokens. Spread traffic across synthetic user tokens or increase limit via `/admin ratelimit`. |
| **HTTP 403 Forbidden** | Missing or expired OAuth Bearer token | Refresh authentication via Discord login or provide valid service token in `--token`. |
| **Pub/Sub backlog not draining** | Worker concurrency saturated or worker crash | Check Cloud Logging with query: `resource.type="cloud_run_revision" textPayload:"error"` to inspect worker stack trace. |
| **Messages appearing in DLQ** | Event schema mismatch or repeated worker failure (> 5 retries) | Inspect DLQ subscription. Use correlation ID from load report to find failed message trace in Cloud Logging. |

---

## 7. Scaling Demonstration Script for the Oral Defense (C08 §2)

During the oral presentation, follow this 3-minute sequence to prove scalability to the jury:

1. **Step 1 (Context)**: Display the architecture diagram ([docs/architecture.md](architecture.md)) explaining the decoupled Gateway $\to$ Proxy $\to$ Pub/Sub $\to$ Worker pipeline.
2. **Step 2 (Visual Baseline)**: Open the live web frontend canvas and the Cloud Monitoring application dashboard side-by-side. Point out that the queue is empty and the error rate is 0%.
3. **Step 3 (Execute Burst)**:
   - In terminal, run: `node tests/load/burst-load.mjs -c 15 -n 300 -b 9`
   - Simultaneously, use the frontend canvas brush tool ($5\times 5$ or $9\times 9$) to draw directly on screen.
4. **Step 4 (Live Dashboard Proof)**:
   - Show the immediate jump in request count on the dashboard ($> 80\text{ req/s}$).
   - Show the p95 latency staying flat ($< 150\text{ ms}$) thanks to asynchronous Pub/Sub delegation.
   - Show the Pub/Sub queue depth rise temporarily to ~100–200 messages and drain back to 0 as workers scale out.
   - Show the web canvas updating in real-time with all 2,700+ pixels without any browser refresh.
5. **Step 5 (Log Trace Search)**: Copy one of the sample `correlationId` values printed in the load test report and paste it into Cloud Logging:
   ```
   jsonPayload.correlationId="trace-load-xxx"
   ```
   Show the single correlated journey from the proxy ingress log to the worker processing log.
