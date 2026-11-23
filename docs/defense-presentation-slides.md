---
marp: true
theme: default
paginate: true
header: "Cloud Native DevOps — teampasx — Oral Defense"
footer: "Epitech 2026 — Collaborative Pixel Canvas"
style: |
  section {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    padding: 35px 50px;
    font-size: 20px;
  }
  h1 { color: #0284c7; font-size: 36px; }
  h2 { color: #0f172a; font-size: 26px; border-bottom: 2px solid #0284c7; padding-bottom: 6px; }
  h3 { color: #334155; font-size: 22px; }
  code { background-color: #f1f5f9; color: #0f172a; border-radius: 4px; padding: 2px 6px; font-size: 17px; }
  table { font-size: 16px; border-collapse: collapse; width: 100%; margin-top: 10px; }
  th { background-color: #0284c7; color: white; padding: 8px 12px; }
  td { border: 1px solid #cbd5e1; padding: 6px 10px; }
  .badge { background: #e0f2fe; color: #0369a1; padding: 3px 8px; border-radius: 9999px; font-weight: bold; }
---

# Collaborative Pixel Canvas
## Cloud Native: DevOps, IaC & Serverless Architecture

**Team**: `teampasx`  
**Members**: Quentin Duval (`Qua-9-9-1`), Aurélien Baraquin (`lechatbleu`), Louis HLT (`LouisHLT`)  
**Date**: Novembre 2026  
**Environments**: `teampasx-cloudnative-dev` & `teampasx-cloudnative-prd` (`europe-west1`)

---

## 1. Executive Summary & Core Mission

### The Challenge
Deliver a massively multi-user, real-time collaborative canvas ($10\,000 \times 10\,000$ pixels) inspired by r/place, driven simultaneously by a Discord Bot and an interactive Web App.

### Core Architectural Decisions
- **Two Strictly Isolated Layers**:
  1. **Kubernetes Foundation (GKE)**: Dedicated 100% to self-hosted GitHub Actions runners (ARC). *No application code runs on GKE*.
  2. **100% Serverless Application**: Ingress via Google API Gateway, private Cloud Run functions, Google Cloud Pub/Sub, Firestore NoSQL, and Cloud Storage.
- **Strict Architectural Guarantees**:
  - **Zero Polling**: 100% event-driven data streaming to the browser.
  - **Zero Direct Writes**: All user actions are mediated via API Gateway, proxies, and Pub/Sub.
  - **Keyless Security**: Workload Identity Federation (WIF) eliminates long-lived credentials.

---

## 2. High-Level System Architecture

```
                       [ Discord Webhook / Web Client ]
                                     |
                                     v HTTPS (TLS 1.3)
                       +----------------------------+
                       |    Google API Gateway      |
                       +----------------------------+
                                     | IAM (run.invoker)
                                     v
                   +------------------------------------+
                   | Private Cloud Run Ingress Proxies  |
                   | (web-draw-proxy / discord-proxy)   |
                   +------------------------------------+
                                     | Event Publishing
                                     v
                 +----------------------------------------+
                 |    Cloud Pub/Sub (pixel-draw-events)   |
                 |     + Dead-Letter Queue (DLQ)          |
                 +----------------------------------------+
                                     | Push Subscription
                                     v
                   +------------------------------------+
                   |     draw-worker (Cloud Run)        |
                   +------------------------------------+
                           /          |             \
                          v           v              v
            +----------------+ +---------------+ +------------------+
            | Firestore NoSQL| | Delta Streams | | GCS Bucket       |
            | (64x64 Chunks) | | (onSnapshot)  | | (Snapshots / 1h) |
            +----------------+ +---------------+ +------------------+
```

---

## 3. DevOps, GitFlow & Cryptographic Commit Signing

### Production GitFlow Model
- `main` branch protected: direct pushes forbidden, requires pull request review + passing CI checks.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`) enforced via pre-commit hook.
- Cryptographic GPG commit signing enforced across all members (Key ID `2EE24FD45EE687600183E0DDF6572416141924C2`).

### Automated CI/CD Pipeline Gates
1. **Secret Scanning**: Gitleaks analyzes entire git commit history on every PR.
2. **Documentation Sync**: Verification that code modifications update corresponding docs.
3. **Monorepo Automated Tests**: **139 tests passing with 0 failures** across all modules.
4. **Terraform Validation**: `fmt -check`, `validate`, and `tflint` on all 3 stacks.
5. **Keyless Plan/Apply**: Workload Identity Federation assumes `github-plan` / `github-apply`.

---

## 4. Foundation: Dedicated GKE & Actions Runner Controller

### Role & Purpose of GKE
- GKE is **exclusively reserved** for hosting self-hosted GitHub Actions runners.
- Solves CI queue bottlenecks, enables Docker-in-Docker workflows, and avoids third-party rate limits.

### Architecture & Node Pools
| Pool Name | Machine Type | Sizing | Purpose & Taints |
|---|---|:---:|---|
| **`system-pool`** | `e2-small` | 1 fixed | CoreDNS, External Secrets Operator, ARC Controller |
| **`runner-pool`** | `e2-medium` (Spot) | **0 to 2** (Autoscale) | Ephemeral ARC runner pods. Taint: `runner=true:NoSchedule` |

### Scale-to-Zero Guarantee
When CI is idle, `runner-pool` scales to **0 nodes**. Cost is near-zero (only 1 `e2-small` node running).

---

## 5. ARC Runner Autoscaling Demonstration

### Dynamic Provisioning Lifecycle
1. **Workflow Queued**: GitHub Actions job with `runs-on: arc-dev` triggers ARC scale set.
2. **Ephemeral Pod Created**: ARC controller spins up runner pod matching node taint.
3. **Node Scale-Up**: GKE node autoscaler detects pending pod and provisions an `e2-medium` Spot VM within ~60 seconds.
4. **Job Execution**: The test/build pipeline executes inside the private VPC.
5. **Clean Termination**: Pod terminates immediately upon completion; idle node scales back down to 0 after threshold.

```
0 Nodes (Idle) ---> Job Queued ---> ARC Pod Pending ---> 1-2 Spot Nodes Added
                                                               |
0 Nodes (Idle) <--- Node Terminated <--- Job Done <------------+
```

---

## 6. Runner Authentication: GitHub App & ESO

### Transition from Personal Token (Issue #151)
- Initial setup used a Personal Access Token (`arc-github-token`), creating personal account coupling.
- Successfully migrated to an **Organization-Owned GitHub App** (ADR-0016).

### Secret Synchronization Flow
1. GitHub App credentials stored in Google Secret Manager (`prevent_destroy = true`):
   - `arc-github-app-id` (App ID)
   - `arc-github-app-installation-id` (Installation ID)
   - `arc-github-app-private-key` (RSA PEM Private Key)
2. **External Secrets Operator (ESO)** authenticates to GCP via Workload Identity.
3. ESO syncs secrets into Kubernetes secret `arc-github` in namespace `arc-runners`.
4. Controller rotates tokens dynamically without any secret touching Terraform state.

---

## 7. Serverless Ingress: Google API Gateway & Proxies

### Central Ingress Point (`canvas-gw`)
- Fully managed Google API Gateway based on OpenAPI 2.0 (`openapi.yaml.tftpl`).
- Terminated with TLS 1.3; applies endpoint routing, quota validation, and CORS policies.

### Private Function Backend Isolation
- All Cloud Run backend functions are deployed with `--no-allow-unauthenticated`.
- The IAM role `roles/run.invoker` is granted **exclusively** to the API Gateway Service Account.
- Direct invocation of backend URLs from the public internet returns **HTTP 403 Forbidden**.
- Backends define explicit `jwt_audience: ${service_url}` to guarantee authentication integrity.

---

## 8. Asynchronous Message Broker & Dead-Letter Queue

### Decoupling Ingress from Processing
- Ingress proxies acknowledge client requests in **< 50 ms** with HTTP `202 Accepted`.
- Eliminates timeout risks (e.g., Discord's strict 3-second webhook limit).

### Google Cloud Pub/Sub Pipeline
- **Topic**: `pixel-draw-events` with CloudEvent 1.0 JSON envelopes.
- **Push Subscription**: `draw-worker-sub` with 60-second ACK deadline and exponential backoff retry (10s to 600s).
- **Dead-Letter Queue (DLQ)**: `pixel-draw-events-dlq` receives failed events after 5 delivery attempts.
- **Monitoring**: Real-time alerts configured on DLQ message count > 0 and backlog age > 60s.

---

## 9. Data Model: 64×64 Chunks & Last-Write-Wins

### The 10,000 × 10,000 Canvas Challenge
- Total pixels: $100\,000\,000$ (100 million pixels).
- Storing the canvas in 1 single document violates Firestore's **1 write/sec/document** limit.
- Storing individual pixel documents would consume 100 million read/write operations.

### Optimal 64×64 Chunking Algorithm
- Grid partitioned into $157 \times 157$ chunk documents ($4\,096$ pixels per chunk).
- Chunk document payload: ~16 KB (compact and fast to serialize).
- **Last-Write-Wins (LWW)**: In a Firestore transaction, incoming pixel timestamp is compared:
  $$\text{incoming.t} > \text{current.t} \implies \text{Apply Update}$$
- **Idempotence**: `eventId` tracked in `recentEvents` array to eliminate Pub/Sub duplicates.

---

## 10. Instant $O(1)$ Canvas Reset (Epoch Mechanism)

### The Administrative Reset Problem
Attempting to erase 100 million pixels by scanning and deleting documents in Firestore would:
- Take hours to complete.
- Incur massive Cloud Firestore write costs.
- Risk transaction timeouts and partial state inconsistencies.

### The $O(1)$ Solution: Epoch Precedence
1. The canvas version is tracked by an integer `epoch` stored in document `config/system`.
2. `/admin clear` simply executes `epoch = epoch + 1`.
3. Every chunk document contains the epoch in which it was painted.
4. **Instant Invalidation**: When reading chunks, if $\text{chunk.epoch} < \text{system.epoch}$, all pixels are treated as blank (`#FFFFFF`).
5. Complexity is strictly **$O(1)$** in time, cost, and network transfer!

---

## 11. Real-Time Frontend: Zero Polling Architecture

### Mandatory Subject Constraint (C07 §3)
- **Zero Polling**: No `setInterval`, no polling loops, no "Refresh" buttons.

### Implementation: Native Firestore Streaming
- Browser establishes native Firestore streaming listeners (`onSnapshot`).
- Real-time updates push directly over persistent HTTP/2 and WebSockets.

### Viewport Frustum Culling
- Only chunks currently visible inside the user's screen are subscribed to.
- When the user pans or zooms, off-screen chunk listeners are automatically unsubscribed via `unsubscribe()`.
- Guarantees smooth 60 FPS performance and minimizes client memory and database bandwidth.

---

## 12. Frontend Usability & Power Features

### HTML5 Canvas 2D Engine
- Supports smooth pan (mouse drag / arrow keys) and zoom levels from $0.25\times$ to $32\times$.
- Coordinate jump dialog to teleport directly to any $(X, Y)$ coordinate.
- Real-time bidirectional URL hash synchronization (`#x=5000&y=5000&z=1`).

### Minimap Radar
- Interactive $140 \times 140$ radar showing active canvas overview and viewport bounding box.
- Click-and-drag navigation directly within the minimap.

### Pixel Inspector & Eyedropper
- Clicking or hovering over any pixel displays author tag, Discord avatar, and last modified date.
- Eyedropper tool (`I` or `Alt + Click`) samples any painted color instantly.

---

## 13. Brush Tool & Token Rate Limiting

### Multi-Pixel Brush Sizes
- Selectable brush sizes: 1px (1 pixel), 3px (9 pixels), 5px (25 pixels), 9px (81 pixels).
- Batched into a single authenticated event payload sent to `/draw`.

### The Non-Truncation Rule (C07 §3)
- Token bucket quota: 1 token / minute, max burst capacity = 20 tokens.
- **Rule**: If a brush stroke exceeds remaining tokens, it is **explained and rejected**.
- **Never Truncated**: Silently truncating a stroke would destroy the user's artwork.
- Error Toast: *"Trait supérieur à la capacité maximale (25 pixels > 20 max). Réduisez la taille du pinceau. Le trait n'est pas tronqué pour préserver l'intégrité du dessin."*

---

## 14. Discord Bot & Private Snapshot Generation

### Serverless Interactions Architecture
- Discord communicates via outbound HTTPS webhooks to API Gateway.
- Proxy validates Ed25519 signature and returns immediate deferred response (`type: 5`).

### Mandatory Commands Implemented
- `/draw x y color`: Asynchronous pixel draw with token validation.
- `/get x y`: Inspects pixel metadata and returns a rendered PNG tile.
- `/snapshot`: Generates timestamped full-canvas PNG in Cloud Storage.
- `/admin pause | resume | clear | ratelimit`: Admin controls protected by ADR-0019 role checks.

### Private Snapshot Storage & 1h Signed URLs
- Cloud Storage bucket has `public_access_prevention = "enforced"`.
- Snapshots shared via cryptographic **Google Cloud Signed URLs** valid for exactly **1 hour**.

---

## 15. Security Architecture & Principle of Least Privilege

### Dedicated Service Accounts (PoLP)
| Identity | Granted Roles | Strictly Forbidden |
|---|---|---|
| `sa-api-gateway` | `roles/run.invoker` | Cannot read Firestore, GCS, or Secret Manager |
| `sa-web-draw-proxy` | `roles/pubsub.publisher`, `roles/cloudtrace.agent` | Cannot write to Firestore or read secrets |
| `sa-draw-worker` | `roles/datastore.user`, `roles/storage.objectAdmin` | Cannot access OAuth client secrets |
| `sa-external-secrets` | `roles/secretmanager.secretAccessor` (on runner secrets) | Cannot access database or storage |
| `github-plan` / `apply` | Viewer / Editor + WIF OIDC bindings | No long-lived service account keys |

### Zero Client Direct Writes
- Firestore rules (`firestore.rules`): `allow write: if false;` on all collections.
- Database access is strictly confined to authenticated backend worker functions.

---

## 16. Observability: Distributed Tracing & Cloud Trace

### W3C Distributed Tracing Standard
- Pure TypeScript implementation (`app/common/src/tracer.ts`) with zero runtime dependencies.
- Propagates W3C `traceparent` (`00-${traceId}-${spanId}-${flags}`).

### End-to-End Waterfall Trace Flow
1. **API Gateway / Proxy**: Ingests request, creates Span 1, attaches `traceparent` header.
2. **Pub/Sub Broker**: Message envelope carries `traceParent` metadata.
3. **Draw Worker**: Extracts parent span, creates Span 2, and updates chunk in Firestore.
4. **Cloud Logging Correlation**: All log entries emit `logging.googleapis.com/trace` linking directly to Cloud Trace Explorer.

---

## 17. Structured Logging & Alerting Policies

### Automated Sensitive Data Redaction
- `StructuredLogger` parses all log payloads and recursively masks sensitive fields:
  - `token`, `secret`, `authorization`, `signature`, `password`, `key` $\implies$ `[REDACTED]`
- Validated by automated unit tests in `logger.test.ts`.

### Terraform-Defined Dashboards & Alerts
- **Application Dashboard** (`dashboards.tf`): Invocations/sec, 5xx errors, p95 latency, queue backlog.
- **Cluster Dashboard** (`dashboard_cluster.tf`): GKE node autoscaling, pod CPU/RAM, runner jobs.
- **Real-Time Email Alerts** (`alerts.tf`):
  1. 5xx Error Rate > 5% over 5-minute rolling window.
  2. DLQ Message Count > 0 (immediate alert).
  3. Pub/Sub Unacknowledged Backlog Age > 60 seconds.

---

## 18. Demonstrated Scalability: Burst Load Engine

### Purpose-Built Load Engine (`tests/load/burst-load.mjs`)
- Native Node.js CLI tool with zero external dependencies.
- Simulates concurrent users, random coordinate selection, and burst draws.
- Computes statistical latency percentiles: min, p50, p95, p99, max, and error rates.

### Validation Under Load
- Executed in dry-run and live modes (`npm run test:load`).
- Verified system behavior under burst load:
  - Pub/Sub absorbs traffic spikes without request dropping.
  - Rate limiting correctly emits HTTP 429 when tokens are exhausted.
  - GKE runner nodes and Cloud Run instances scale dynamically under demand.

---

## 19. FinOps & Cost Optimization Matrix

### Rigorous Cost Safeguards
- **GKE Runner Pool**: Uses Google Cloud Spot VMs, achieving **60% to 91% cost savings**.
- **Scale to Zero**: Node pool scales to 0 nodes when no CI jobs are active.
- **Zonal Pinning**: Resources pinned to `europe-west1-b` to eliminate inter-zone network egress fees.
- **GCS Lifecycle Policies**: Canvas snapshots automatically deleted after 30 days.
- **Budget Alerts**: Google Cloud Billing alerts configured at 50%, 90%, 100% current spend, and 100% forecasted spend with email alerts.

---

## 20. Conclusion & Compliance Scorecard

### Official Subject Checklist (§5.6)
| Criterion | Description | Compliance Status |
|---|---|:---:|
| **C01–C03** | GitFlow, GPG signed commits, WIF keyless CI/CD, Terraform | ✅ **100% Compliant** |
| **C04** | GKE private cluster, ARC self-hosted runners, node autoscaling | ✅ **100% Compliant** |
| **C05** | Serverless functions, API Gateway, least-privilege IAM, HTTPS | ✅ **100% Compliant** |
| **C06** | Pub/Sub broker, DLQ, 64×64 chunking, LWW, $O(1)$ epoch clear | ✅ **100% Compliant** |
| **C07** | Discord bot, signed URLs, real-time zero-polling web, brush tool | ✅ **100% Compliant** |
| **C08** | Cloud Trace, structured logs, redaction, dashboards, load test | ✅ **100% Compliant** |

### Live Q&A Session
*The team is ready to answer questions and demonstrate any component live.*
