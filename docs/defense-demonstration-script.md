# Defense Live Demonstration Script

Step-by-step oral defense demonstration script covering the full Cloud Native DevOps workflow: IDE, GitFlow, PR review, automated CI/CD deployment, GKE runner autoscaling, Discord bot interactions, real-time zero-polling web frontend, distributed tracing, and fallback procedures.

---

## Pre-Demonstration Setup Checklist (T - 15 min)

Open and arrange the following browser tabs and terminal windows before the presentation starts:

1. **Browser Windows / Tabs**:
   - Tab 1: **Production Web Frontend** (`https://canvas.teampasx.dev` or local preview `http://localhost:5173`)
   - Tab 2: **Discord Channel** with the deployed Canvas Bot active
   - Tab 3: **GitHub Repository**: Pull Requests and Actions tabs (`R-PalaceOnDanse/Cloud-Native-DevOps`)
   - Tab 4: **Google Cloud Console (`teampasx-cloudnative-prd`)**:
     - *Monitoring Dashboards*: Application Dashboard & Cluster Dashboard
     - *Cloud Trace*: Trace List & Waterfall View
     - *Cloud Logging*: Logs Explorer with filter `resource.type="cloud_run_revision"`
     - *GKE Clusters*: Nodes & Workloads view
2. **Terminal Split Windows**:
   - Terminal 1: GKE runner monitor (`bash scripts/watch-runner-scaling.sh prd`)
   - Terminal 2: Real-time Cloud Logging stream (`gcloud logging tail 'resource.type="cloud_run_revision"'`)
   - Terminal 3: Working terminal for Git commands and live load test executions

---

## Act 1: GitFlow, Cryptographic Signing & CI/CD Pipeline

**Objective**: Demonstrate production-grade GitFlow, GPG commit signing, automated CI checks, and keyless cloud deployment via OIDC / Workload Identity.

### Step 1.1: Local Edit & Cryptographic Signing
- **Action**: Make a small visible change or show recent signed commit in git log:
  ```bash
  git log -n 3 --show-signature
  ```
- **Narrative**:
  > *"Every commit across our repository is strictly signed using a personal GPG hardware/software key, verified by GitHub with the green 'Verified' badge. Direct commits to `main` are branch-protected and forbidden. All changes flow through feature branches and pull requests."*

### Step 1.2: Pull Request Inspection & CI Gates
- **Action**: Open GitHub PR view in browser.
- **Narrative**:
  > *"On each pull request, our automated CI pipeline triggers on GitHub Actions runners. It executes:*
  > 1. *Gitleaks static secret scanning across the full commit history to prevent credential leaks.*
  > 2. *Documentation sync checks ensuring code changes update corresponding markdown docs.*
  > 3. *Complete monorepo test suite (139 automated tests with 0 failures).*
  > 4. *Terraform fmt and validate across our access, foundation, and serverless stacks.*
  > 5. *Terraform plan authenticating to GCP via Workload Identity Federation without any stored keys."*

---

## Act 2: Foundation & ARC Runner Autoscaling Demo

**Objective**: Prove that the GKE cluster is 100% dedicated to self-hosted CI/CD runners, using Spot VMs and scaling to zero when idle.

### Step 2.1: Show Baseline Idle State (0 Runner Nodes)
- **Action**: In Terminal 1, show current GKE node status:
  ```bash
  kubectl get nodes -L role,cloud.google.com/gke-nodepool
  ```
- **Narrative**:
  > *"Notice that our GKE cluster runs a single e2-small node in `system-pool` for CoreDNS, External Secrets Operator, and ARC controller. The `runner-pool` is currently at 0 nodes, costing zero compute while idle."*

### Step 2.2: Trigger Load & Observe Dynamic Autoscaling
- **Action**: Trigger the runner load test workflow or run the test script:
  ```bash
  gh workflow run runner-load-test.yml -f jobs=3
  ```
  Watch Terminal 1 (`scripts/watch-runner-scaling.sh`).
- **Narrative**:
  > *"Actions Runner Controller detects pending jobs in the queue and requests ephemeral runner pods. Because runner pods have a specific taint `runner=true:NoSchedule`, GKE node autoscaler automatically provisions an e2-medium Spot VM node within 60 seconds. Once the jobs complete, the pods terminate and the node pool cleanly scales back down to 0."*

---

## Act 3: Real-Time Web Frontend & Canvas Usability

**Objective**: Demonstrate collaborative real-time canvas capabilities with zero polling, brush validation, minimap navigation, and URL state bookmarking.

### Step 3.1: Zero-Polling Verification in Browser DevTools
- **Action**:
  1. Open browser DevTools (`F12`), switch to the **Network** tab, and filter by `Fetch/XHR`.
  2. Point out that **no periodic HTTP polling requests** (`setInterval`) appear.
  3. Show the open WebSocket / streaming channel to Firestore:
- **Narrative**:
  > *"Our frontend implements strict Zero Polling (C07 §3). It uses native Firestore `onSnapshot` streaming listeners scoped dynamically to the visible viewport (Frustum Culling). Chunks outside the viewport are unsubscribed to conserve client memory and database bandwidth."*

### Step 3.2: Single-Pixel Drawing & Immediate Feedback
- **Action**: Select a color (e.g., `#ef4444`), click a pixel on the canvas.
- **Narrative**:
  > *"When clicking a pixel, the frontend makes an asynchronous HTTP POST to `/draw` through Google API Gateway. The proxy validates the payload and pushes an event to Pub/Sub, returning HTTP 202 Accepted. The worker applies the write with Last-Write-Wins and emits a delta document, causing Firestore to stream the change to all connected clients."*

### Step 3.3: Brush Tool & Non-Truncation Rule
- **Action**:
  1. Select the **Brush tool** and set size to **5px** (25 pixels).
  2. Attempt to draw on the canvas.
  3. Observe the clear error toast: *"Trait supérieur à la capacité maximale (25 pixels > 20 max). Réduisez la taille du pinceau. Le trait n'est pas tronqué pour préserver l'intégrité du dessin."*
- **Narrative**:
  > *"In accordance with subject constraint C07 §3, a brush stroke that exceeds the user's available token quota is never silently truncated. Truncating would corrupt the user's artwork. Instead, the stroke is rejected with an explanation and token quota feedback."*

### Step 3.4: Eyedropper, Minimap & URL Hash Coordinate Sync
- **Action**:
  1. Press `I` or `Alt + Click` on any existing colored pixel to sample its color (Eyedropper tool).
  2. Pan across the canvas and watch the minimap bounding box update smoothly. Click on the minimap to instantly jump to another quadrant.
  3. Observe the URL hash `#x=5000&y=5000&z=2` update dynamically. Copy and paste the URL into a new tab to demonstrate exact coordinate restoring.

---

## Act 4: Discord Bot Interactions & Administration

**Objective**: Demonstrate serverless webhook interactions, Ed25519 signature verification, snapshot exports via private bucket signed URLs, and instant $O(1)$ canvas clear.

### Step 4.1: Discord Commands (`/draw` and `/get`)
- **Action**: In Discord channel:
  ```
  /draw x:1500 y:1500 color:#3b82f6
  /get x:1500 y:1500
  ```
- **Narrative**:
  > *"Discord sends an Ed25519-signed HTTPS webhook to API Gateway. Our proxy verifies the cryptographic signature with the bot public key, returns an immediate deferred response (type 5) within Discord's 3-second timeout, and delegates processing to the draw worker via Pub/Sub."*

### Step 4.2: Snapshot Generation (`/snapshot`)
- **Action**: Run `/snapshot` in Discord.
- **Narrative**:
  > *"The worker stitches all active chunks into a PNG image and stores it in our Cloud Storage snapshot bucket. The bucket is strictly private (`public_access_prevention = enforced`). The bot replies with a cryptographic Google Cloud Signed URL valid for exactly 1 hour."*

### Step 4.3: Instant Administrative Reset (`/admin clear`)
- **Action**: Run `/admin clear` in Discord with an admin account, then show non-admin refusal.
- **Narrative**:
  > *"`/admin clear` performs an instant O(1) reset by incrementing the system epoch in `config/system`. Because all pixel writes are tied to the active epoch, every previous pixel is instantly invalidated without requiring a slow, expensive scan-and-delete of millions of documents in Firestore."*

---

## Act 5: Observability, Cloud Trace & Alerting

**Objective**: Demonstrate end-to-end W3C distributed tracing across serverless microservices, structured log correlation, and real cloud alerting.

### Step 5.1: Cloud Trace Waterfall Inspection
- **Action**: In Google Cloud Console, open **Cloud Trace > Trace List**. Select the most recent `/draw` trace.
- **Narrative**:
  > *"Here is the complete distributed trace spanning our serverless architecture: API Gateway -> `web-draw-proxy` (span 1) -> Pub/Sub message envelope carrying W3C `traceparent` -> `draw-worker` (span 2) -> Firestore transaction. Cloud Logging entries automatically link to this exact trace ID."*

### Step 5.2: Structured Logging & Automatic Redaction
- **Action**: In Cloud Logging, inspect a draw worker log entry.
- **Narrative**:
  > *"Notice that all logs follow our JSON schema with `correlationId`, `eventId`, and Cloud Trace linking fields. Sensitive parameters (OAuth tokens, client secrets, Ed25519 signatures, authorization headers) are automatically sanitized by our logging engine with `[REDACTED]` before leaving memory."*

### Step 5.3: IaC Dashboards & Alerting Policies
- **Action**: Show the Terraform-provisioned Application Dashboard and Alerting policies in GCP Console.
- **Narrative**:
  > *"Our dashboards and alerting policies are declared as code in Terraform (`dashboards.tf`, `alerts.tf`). Critical incidents (5xx error rate > 5%, DLQ messages > 0, Pub/Sub processing backlog > 60s) trigger real email notifications to the operations on-call engineer."*

---

## Fallback & Troubleshooting Procedures

If any cloud or network glitch occurs during the live presentation, execute the corresponding fallback:

| Demonstration Act | Potential Issue | Immediate Fallback Action |
|---|---|---|
| **Act 1: CI/CD & Git** | GitHub Actions queue delay | Show previous passing workflow run [commit `7c52222`] with verified GPG signature and complete job step logs. |
| **Act 2: Runner Autoscale** | GCP Spot VM quota / delay | Show pre-recorded live terminal recording in [docs/runner-auto-scaling-demo.md](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/docs/runner-auto-scaling-demo.md) with timestamped node scaling logs. |
| **Act 3: Web Frontend** | WiFi connectivity interruption | Run local dev server (`npm run dev --prefix app/frontend`) using offline mode and localStorage fallback. |
| **Act 4: Discord Bot** | Discord API rate limit or outage | Run the automated test suite `scripts/register-discord-commands.test.mjs` and execute direct curl to API Gateway `/draw` endpoint. |
| **Act 5: Cloud Trace** | Cloud Trace ingestion delay (1-2 min) | Query Cloud Logging directly with `logging.googleapis.com/trace` filter to show immediate structured correlation. |
