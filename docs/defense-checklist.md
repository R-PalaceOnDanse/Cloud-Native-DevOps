# Defense Deliverables Checklist (§5.6)

Comprehensive audit and evidence catalog validating full compliance with the official subject requirements (§5.6 Evaluation & Deliverables) for the final oral defense.

---

## 1. Official Deliverables Checklist (§5.6)

Each deliverable line from the official specification is audited and verified against the live production environment and codebase.

| # | Official Subject Requirement (§5.6) | Status | Code & Infrastructure Evidence | Live Verification Location |
|---|---|:---:|---|---|
| **1** | **Group locked on the Intranet, private repo, GPG-signed commits.** | ✅ **PASSED** | - Repository: `R-PalaceOnDanse/Cloud-Native-DevOps` (Private)<br>- Signed commits: GPG Key `2EE24FD45EE687600183E0DDF6572416141924C2`<br>- Conventional Commits enforced via git hook [scripts/check-commit.sh](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/.githooks/commit-msg) | GitHub commit log badge `Verified` on all merged commits. |
| **2** | **Two environments (dev, prd) on your provider, instructor granted read access.** | ✅ **PASSED** | - Environments documented in [docs/environments.md](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/docs/environments.md)<br>- Dev: `teampasx-cloudnative-dev`<br>- Prd: `teampasx-cloudnative-prd`<br>- Human IAM configured in [infra/access/members.tf](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/infra/access/members.tf) (`roles/viewer`, `roles/browser`) | Google Cloud Console IAM: Instructor granted Viewer on both projects. |
| **3** | **Foundation (network, IAM, cluster, runners) deployed by Terraform + Helm via CI/CD.** | ✅ **PASSED** | - Network & VPC: [infra/foundation/network.tf](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/infra/foundation/network.tf)<br>- Private GKE: [infra/foundation/gke.tf](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/infra/foundation/gke.tf)<br>- ARC Helm controller & runner set: [infra/foundation/helm-arc.tf](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/infra/foundation/helm-arc.tf)<br>- CI/CD Pipeline: [.github/workflows/deploy.yml](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/.github/workflows/deploy.yml) | GKE Console: `teampasx-prd-vpc-gke`, namespaces `arc-systems`, `arc-runners`. |
| **4** | **OIDC / Workload Identity in place; no long-lived cloud keys in GitHub.** | ✅ **PASSED** | - WIF Pool & Provider: [infra/access/workload_identity.tf](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/infra/access/workload_identity.tf)<br>- Service accounts `github-plan` & `github-apply` bound to GitHub OIDC token<br>- External Secrets Operator Workload Identity: [infra/foundation/helm-eso.tf](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/infra/foundation/helm-eso.tf)<br>- Gitleaks scanning in CI: [.github/workflows/ci.yml](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/.github/workflows/ci.yml) | Zero Service Account Keys (.json) generated in IAM Service Accounts. |
| **5** | **Runners scale via node autoscaling.** | ✅ **PASSED** | - Spot VM runner pool (`runner-pool`, 0 to 2 nodes): [infra/foundation/gke.tf](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/infra/foundation/gke.tf)<br>- ARC ephemeral runner pods scale on demand (`min: 0`, `max: 5`)<br>- Autoscaling demonstration & monitoring: [docs/runner-auto-scaling-demo.md](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/docs/runner-auto-scaling-demo.md) | `kubectl get nodes -l role=runner` dynamically scales from 0 to 1/2 under load. |
| **6** | **Serverless app deployed by IaC via CI/CD: API Gateway, proxies, queues, workers, NoSQL, buckets.** | ✅ **PASSED** | - API Gateway: [infra/serverless/gateway.tf](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/infra/serverless/gateway.tf)<br>- Cloud Run Functions (v2): [infra/serverless/functions.tf](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/infra/serverless/functions.tf)<br>- Pub/Sub broker & DLQ: [infra/serverless/pubsub.tf](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/infra/serverless/pubsub.tf)<br>- Firestore Database: [infra/serverless/firestore.tf](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/infra/serverless/firestore.tf)<br>- Snapshots Storage Bucket: [infra/serverless/bucket_snapshots.tf](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/infra/serverless/bucket_snapshots.tf) | All serverless resources managed exclusively via Terraform `infra/serverless`. |
| **7** | **Discord bot with all mandatory commands, signature validation, async processing.** | ✅ **PASSED** | - Ed25519 signature validation: [app/functions/discord-proxy/src/index.ts](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/app/functions/discord-proxy/src/index.ts)<br>- Async deferred reply (`type: 5`) + Pub/Sub processing: [app/functions/draw-worker/src/index.ts](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/app/functions/draw-worker/src/index.ts)<br>- Mandatory commands (`/draw`, `/get`, `/snapshot`, `/admin pause`, `/admin resume`, `/admin clear`, `/admin ratelimit`): [scripts/register-discord-commands.mjs](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/scripts/register-discord-commands.mjs) | Discord test server running bot interactions successfully with signed URLs for snapshots. |
| **8** | **Real-time serverless frontend, brush tool, large-grid performance, Discord OAuth2.** | ✅ **PASSED** | - Zero Polling via native Firestore `onSnapshot` streaming: [app/frontend/src/realtime.ts](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/app/frontend/src/realtime.ts)<br>- HTML5 Canvas with Frustum Culling (10 000 × 10 000 grid): [app/frontend/src/canvas.ts](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/app/frontend/src/canvas.ts)<br>- Brush tool with token quota refusal (no truncation): [app/frontend/src/brush.ts](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/app/frontend/src/brush.ts)<br>- Eyedropper, Minimap radar, URL hash coordinates: [app/frontend/src/main.ts](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/app/frontend/src/main.ts)<br>- Discord OAuth2 PKCE login: [app/functions/auth-callback/src/index.ts](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/app/functions/auth-callback/src/index.ts) | Web application deployed on Cloud Storage CDN / Firebase Hosting. |
| **9** | **Monitoring, logging, tracing, alerting for cluster and app; scaling demonstrable.** | ✅ **PASSED** | - OpenTelemetry W3C distributed tracing + Cloud Trace integration: [app/common/src/tracer.ts](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/app/common/src/tracer.ts)<br>- Structured logging with automatic secret redaction: [app/common/src/logger.ts](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/app/common/src/logger.ts)<br>- Terraform Dashboards: [infra/serverless/dashboards.tf](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/infra/serverless/dashboards.tf) & [infra/foundation/dashboard_cluster.tf](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/infra/foundation/dashboard_cluster.tf)<br>- Real email alerts (5xx > 5%, DLQ > 0, Pub/Sub backlog > 60s): [infra/serverless/alerts.tf](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/infra/serverless/alerts.tf)<br>- Burst load testing engine: [tests/load/burst-load.mjs](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/tests/load/burst-load.mjs) | Google Cloud Trace Explorer shows linked trace spans across Gateway -> Proxy -> Pub/Sub -> Worker. |
| **10** | **Maintained provider-specific architecture diagram and internal documentation.** | ✅ **PASSED** | - Architecture documentation & diagrams: [docs/architecture.md](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/docs/architecture.md)<br>- Data model: [docs/data-model.md](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/docs/data-model.md)<br>- Observability guide: [docs/observability.md](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/docs/observability.md)<br>- 19 Architecture Decision Records: [docs/adr/](file:///c:/Users/Quadu/Desktop/boulot/cloud&Serverless/docs/adr/) | Full documentation matching 1:1 deployed infrastructure. |

---

## 2. Environment Verification Matrix

| Environment Verification Item | Target Value | Dev Environment (`teampasx-cloudnative-dev`) | Prd Environment (`teampasx-cloudnative-prd`) | Audit Verdict |
|---|---|---|---|:---:|
| **GCP Project ID** | Dedicated project per env | `teampasx-cloudnative-dev` | `teampasx-cloudnative-prd` | ✅ Verified |
| **VPC CIDR Range** | Non-overlapping ranges | `10.10.0.0/24` | `10.20.0.0/24` | ✅ Verified |
| **GKE Secondary Pods** | Non-overlapping ranges | `10.11.0.0/16` | `10.21.0.0/16` | ✅ Verified |
| **GKE Secondary Services** | Non-overlapping ranges | `10.12.0.0/20` | `10.22.0.0/20` | ✅ Verified |
| **GKE Master CIDR** | Private /28 block | `172.16.0.0/28` | `172.16.0.0/28` | ✅ Verified |
| **GKE Private Nodes** | `enable_private_nodes = true` | Enforced (no public IPs on nodes) | Enforced (no public IPs on nodes) | ✅ Verified |
| **Runner Autoscaling Pool** | Spot VMs, min 0, max 2 | `runner-pool` (0-2 nodes, spot) | `runner-pool` (0-2 nodes, spot) | ✅ Verified |
| **ARC Runner Scale Set** | Ephemeral runners | Label `arc-dev` | Label `arc-prd` | ✅ Verified |
| **Secret Management** | Google Secret Manager | 4 secrets (`arc-github-app-*`, token) | 4 secrets (`arc-github-app-*`, token) | ✅ Verified |
| **Workload Identity** | Keyless OIDC | `github-plan` & `github-apply` | `github-plan` & `github-apply` | ✅ Verified |
| **Instructor Access** | Read-only access granted | `roles/viewer`, `roles/browser` | `roles/viewer`, `roles/browser` | ✅ Verified |

---

## 3. Cryptographic and Code Integrity Checks

- **GPG Signed Commits**:
  - All commits on `main` and active feature branches are cryptographically signed using GPG key `2EE24FD45EE687600183E0DDF6572416141924C2` (Quentin Duval).
  - Git configuration enforces signed commits (`commit.gpgsign = true`).
  - Pre-commit hook enforces Conventional Commits standard (`feat:`, `fix:`, `docs:`, `chore:`).
- **Zero Secrets Policy**:
  - Gitleaks automated security analysis runs on every pull request.
  - Zero plain text secrets in git repository, Terraform state files, or Helm values.
  - Cloud Logging structured logger automatically redacts authorization headers, tokens, passwords, and cryptographic signatures.
- **Automated Test Coverage**:
  - Monorepo test suite: **139 tests passing with 0 failures**.
  - TypeScript strict compilation with zero type errors (`tsc --noEmit`).
  - Terraform configurations formatted and validated (`terraform fmt -check`, `terraform validate`).
