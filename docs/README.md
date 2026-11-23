# Documentation Index

Welcome to the Cloud Native DevOps documentation hub. This directory contains all technical documentation, architecture specifications, operational runbooks, and defense preparation deliverables for the Collaborative Pixel Canvas project.

---

## 1. Architecture & Design

- **[architecture.md](architecture.md)**: Global system architecture, component topologies, and end-to-end data flow diagrams.
- **[data-model.md](data-model.md)**: Firestore chunking strategy (64×64), Last-Write-Wins (LWW) conflict resolution, and $O(1)$ epoch resets.
- **[events.md](events.md)**: CloudEvent specification, event schemas, payload formats, and correlation ID tracking.
- **[adr/](adr/)**: Architecture Decision Records (ADR-0001 through ADR-0019) documenting all major architectural choices.

---

## 2. Infrastructure & Environments

- **[infra.md](infra.md)**: Terraform layout, provider rules, GKE cluster provisioning, and self-hosted runner infrastructure.
- **[environments.md](environments.md)**: Environment descriptions, GCP project configurations, and resource catalog for `dev` and `prd`.
- **[serverless.md](serverless.md)**: API Gateway OpenAPI configuration, Cloud Run functions (v2), IAM roles, and storage buckets.
- **[ci.md](ci.md)**: CI/CD pipeline automation, branch protection, Workload Identity Federation (WIF), and deployment workflows.
- **[development.md](development.md)**: Local developer setup, `mise` tooling, git commit signing, and pre-commit hooks.

---

## 3. Application Components

- **[frontend.md](frontend.md)**: Real-time HTML5 Canvas frontend, zero-polling architecture, brush tool, eyedropper, minimap radar, and Discord OAuth2 login.
- **[runner-auto-scaling-demo.md](runner-auto-scaling-demo.md)**: Live demonstration guide and validation data for GKE Spot VM runner autoscaling (0 to 2 nodes).
- **[load-testing.md](load-testing.md)**: Load testing engine, burst traffic simulation, rate limiting verification, and latency benchmarking.

---

## 4. Observability & Operations

- **[observability.md](observability.md)**: Monitoring dashboards, alerting policies, Cloud Trace distributed tracing (W3C), and Cloud Logging correlation.
- **[logging.md](logging.md)**: Structured JSON logging format and automated credential redaction engine.

---

## 5. Defense Preparation & Auditing

- **[defense-checklist.md](defense-checklist.md)**: Official subject deliverables audit (§5.6) with evidence links for all requirements (Issue #94).
- **[defense-demonstration-script.md](defense-demonstration-script.md)**: Live demonstration script covering IDE, GitFlow, runner autoscaling, Discord bot, real-time web, and fallback runbook (Issue #92).
- **[security-walkthrough.md](security-walkthrough.md)**: Security architecture walk-through sheet detailing least privilege IAM, private functions, secrets, and cryptographic verification (Issue #93).
- **[defense-rehearsal.md](defense-rehearsal.md)**: Oral defense preparation guide, 3-minute executive pitch, and answers to 20+ technical jury questions (Issue #95).
