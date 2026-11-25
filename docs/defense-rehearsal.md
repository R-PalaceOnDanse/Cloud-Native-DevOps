# Oral Defense Rehearsal & Jury FAQ Guide

Comprehensive oral defense preparation cheat sheet containing architecture rationale, technical answers to 20+ likely jury questions, and strategies to defend project design choices without external assistance.

---

## 1. 3-Minute Executive Pitch

> *"Our project delivers an enterprise-grade, event-driven collaborative pixel canvas (r/place clone) deployed on Google Cloud across two strictly isolated environments (`dev` and `prd`).*
> 
> *Our architecture cleanly splits into two layers:*
> 1. *A **Kubernetes Foundation (GKE + ARC)** dedicated 100% to running self-hosted, ephemeral GitHub Actions CI/CD runners with Spot VM node autoscaling from 0 to 2 nodes.*
> 2. *A **100% Serverless Application Layer** comprising Google API Gateway, private Cloud Run functions, Google Cloud Pub/Sub, Firestore NoSQL in chunks of 64×64 pixels, and private Cloud Storage buckets.*
> 
> *Key engineering highlights:*
> - *Strict Zero Direct Writes and Zero Polling: the frontend streams real-time updates via native Firestore snapshot listeners with viewport frustum culling.*
> - *Keyless CI/CD authentication via Workload Identity Federation (WIF) and GPG-signed git commits.*
> - *Full W3C OpenTelemetry distributed tracing correlating HTTP ingress, Pub/Sub message propagation, Cloud Run execution, and Cloud Logging with automatic credential redaction.*
> - *Everything is declared and reproduced as code across Terraform, Helm, and TypeScript."*

---

## 2. Technical Q&A Rehearsal by Domain

### Domain 1: Foundation & Infrastructure as Code (GKE, Runners, Terraform)

#### Q1: "Why did you provision a GKE cluster if the subject requires a 100% serverless application?"
- **Answer**:
  > *"Per subject constraints C05 and C06, application workloads are strictly forbidden on GKE. The GKE cluster is exclusively reserved for hosting our self-hosted GitHub Actions runners using Actions Runner Controller (ARC), External Secrets Operator, and cluster monitoring. This gives us complete control over our CI/CD compute, allows running Docker-in-Docker workflows with isolated networking, and slashes CI costs using Spot VMs that automatically scale to 0 nodes when idle."*

#### Q2: "How does the runner pool scale to 0 nodes without killing the controller?"
- **Answer**:
  > *"We separate workloads into two specialized node pools:*
  > 1. *`system-pool`: 1 fixed e2-small node running CoreDNS, External Secrets Operator, and ARC controller.*
  > 2. *`runner-pool`: e2-medium Spot VM nodes autoscaling from `min: 0` to `max: 2` nodes.*
  > *The runner pool has a taint `runner=true:NoSchedule` and label `role=runner`. System pods never schedule on runner nodes, allowing GKE to cleanly terminate runner VMs when no jobs are queued."*

#### Q3: "How does Actions Runner Controller authenticate to GitHub without a long-lived personal access token?"
- **Answer**:
  > *"Initially we used a PAT, but in Issue #151 (ADR-0016) we migrated to an organization-owned GitHub App. Three secrets (`arc-github-app-id`, `arc-github-app-installation-id`, `arc-github-app-private-key`) are stored in Google Secret Manager. External Secrets Operator (ESO) authenticates to GCP via Workload Identity and copies these into the Kubernetes secret `arc-github`. This eliminates personal account coupling and token expiration risks."*

#### Q4: "How do you guarantee that running `terraform destroy` will tear down everything cleanly?"
- **Answer**:
  > *"We explicitly configure `deletion_protection = false` on the GKE cluster, avoid hard-coded resource names, and manage dependencies with `depends_on`. However, critical state safeguards—specifically Secret Manager secrets, GCS state buckets, and budget alerts in `infra/access`—use `prevent_destroy = true` so destroying `foundation` or `serverless` never removes our security anchors or budget limits."*

---

### Domain 2: Serverless Application & Event-Driven Data Flow

#### Q5: "Why did you choose a chunk size of 64×64 pixels instead of storing each pixel or the entire canvas in one document?"
- **Answer**:
  > *"Firestore enforces a hard technical limit of 1 write per second per document. A 10 000 × 10 000 canvas contains 100 million pixels. If the canvas were one document, concurrent draws would immediately fail or bottleneck. Conversely, 100 million individual documents would exceed Firestore read/write quota costs.*
  > *64×64 pixels (4 096 pixels per chunk = 157×157 chunks) is the optimal balance: each chunk document is ~16 KB (well below Firestore's 1 MB limit), allows Last-Write-Wins map updates, and drastically reduces network bandwidth."*

#### Q6: "How do you guarantee Zero Direct Writes from the client to the database?"
- **Answer**:
  > *"Firestore Security Rules (`infra/serverless/firestore.rules`) enforce `allow write: if false;` across all collections. Any direct write attempted from client JavaScript is rejected by Google's storage engine. All writes must go through API Gateway -> `web-draw-proxy` -> Cloud Pub/Sub -> `draw-worker`."*

#### Q7: "How does the canvas handle concurrent writes to the same pixel or chunk?"
- **Answer**:
  > *"We implement Last-Write-Wins (LWW) conflict resolution in `draw-worker`. Each incoming event carries a UTC timestamp (`t`). In a Firestore transaction, we read the chunk, compare `incoming.t > current.t`, and apply the update only if it is newer. Furthermore, every event envelope has a unique `eventId` stored in the chunk's `recentEvents` array to ensure strict idempotence against Pub/Sub at-least-once delivery duplicates."*

#### Q8: "How does `/admin clear` execute in O(1) without timing out or scanning millions of documents?"
- **Answer**:
  > *"Instead of attempting to delete millions of documents in Firestore (which would time out and cost substantial write operations), `/admin clear` simply increments the `epoch` integer in `config/system`. Every chunk document stores its active `epoch`. When the worker or frontend processes pixels, any chunk with an epoch less than the system epoch is treated as instantly blank. The reset is O(1) instantaneous."*

---

### Domain 3: Real-Time Frontend & Canvas Usability

#### Q9: "How do you prove that your frontend implements Zero Polling?"
- **Answer**:
  > *"Open Chrome DevTools Network tab: there is zero recurring HTTP GET requests or `setInterval` calls. Instead, the frontend uses native Firestore `onSnapshot` streaming listeners. Furthermore, we use Frustum Culling: only chunks currently visible in the user's viewport are subscribed to. As the user pans, off-screen chunks are unsubscribed (`unsubscribe()`), conserving memory and Firestore read quotas."*

#### Q10: "What happens if a user submits a brush stroke that exceeds their remaining token quota?"
- **Answer**:
  > *"Per subject constraint C07 §3, a brush stroke that exceeds the token reserve is explained and refused, but **never silently truncated**. Truncating a brush stroke would distort the user's intended drawing. The frontend calculates required tokens, compares against the token bucket limit (20 max), and displays an error toast explaining why the stroke cannot be applied."*

#### Q11: "How does the UI keep track of user position and zoom level?"
- **Answer**:
  > *"Coordinates and zoom are continuously synchronized with the browser URL hash (`#x=5000&y=5000&z=1`). Users can copy the URL and share it; opening the link immediately centers the canvas at that exact coordinate and zoom level."*

---

### Domain 4: Security Architecture & Access Control

#### Q12: "How are your Cloud Run functions protected from direct public internet access?"
- **Answer**:
  > *"All Cloud Run functions are deployed with `--no-allow-unauthenticated`. The IAM role `roles/run.invoker` is granted solely to the API Gateway service account. Any direct HTTP request to the Cloud Run function URL returns HTTP 403 Forbidden. Google API Gateway acts as the single authenticated reverse proxy."*

#### Q13: "How does GitHub Actions authenticate to GCP without service account keys?"
- **Answer**:
  > *"We use Workload Identity Federation (WIF). GitHub acts as an OIDC identity provider. Google Cloud exchanges GitHub's cryptographic OIDC token for short-lived Google IAM access tokens. No `.json` service account keys exist, preventing credential leak risks."*

#### Q14: "How do you protect snapshot images stored in Cloud Storage?"
- **Answer**:
  > *"The snapshot bucket has `public_access_prevention = 'enforced'`, meaning public read access is blocked at the bucket level. To share snapshots, the draw worker uses its IAM credentials to generate a Google Cloud Signed URL with an expiration of exactly 1 hour. After 30 days, a GCS lifecycle rule automatically purges old snapshot objects."*

#### Q15: "How does Discord webhook verification work?"
- **Answer**:
  > *"Discord signs all outgoing webhook HTTP requests using Ed25519 cryptography. In `discord-proxy`, we verify `X-Signature-Ed25519` and `X-Signature-Timestamp` headers using the bot's public key before parsing the payload. If the signature is invalid, we reject the request with HTTP 401 Unauthorized."*

---

### Domain 5: Observability & OpenTelemetry Tracing

#### Q16: "How does distributed tracing work across your serverless architecture?"
- **Answer**:
  > *"We implement W3C TraceContext standards (`traceparent: 00-{traceId}-{spanId}-{flags}`). When a request hits API Gateway, `web-draw-proxy` generates or inherits a 128-bit `traceId` and creates span 1. When publishing to Pub/Sub, the `traceparent` is included in the CloudEvent envelope metadata. `draw-worker` extracts this `traceparent`, sets it as the parent span, and creates span 2. Both microservices link their logs to `projects/{projectId}/traces/{traceId}`, creating a seamless waterfall view in Google Cloud Trace."*

#### Q17: "How do you prevent secrets and tokens from leaking into Cloud Logging?"
- **Answer**:
  > *"We built an automated log sanitization engine in `app/common/src/logger.ts`. Before serializing any log payload to JSON, the engine recursively scans for sensitive keys (`token`, `secret`, `authorization`, `signature`, `password`, `key`) and replaces their values with `[REDACTED]`. This is verified by 4 automated unit tests."*

#### Q18: "What alerting policies are active in production?"
- **Answer**:
  > *"Defined in `infra/serverless/alerts.tf`, we have three real-time alerting policies: 5xx error rate exceeding 5%, Dead-Letter Queue (DLQ) message count greater than 0, and Pub/Sub unacknowledged message backlog exceeding 60 seconds. All alerts route to the operations email channel (`quaduval@gmail.com`)."*

---

## 3. Defense Time Budget & Role Distribution

| Phase | Duration | Responsible Speaker | Content Covered |
|---|:---:|---|---|
| **Phase 1: Architecture Overview** | 3 min | Speaker 1 | High-level architecture, GKE foundation vs Serverless app, 2 environments. |
| **Phase 2: GitFlow & Foundation Demo** | 4 min | Speaker 2 | GPG signed commits, PR review, GKE ARC runner node autoscaling (0->1->0). |
| **Phase 3: Real-Time Frontend & Canvas** | 4 min | Speaker 3 | Zero polling verification, single pixel draw, brush quota refusal, minimap, URL hash. |
| **Phase 4: Discord Bot & Security** | 4 min | Speaker 1 / 2 | Discord commands, private snapshots, instant O(1) clear, WIF, private functions. |
| **Phase 5: Observability & Q&A** | 15 min | All Members | Cloud Trace waterfall, structured logging, alert policies, jury Q&A. |
