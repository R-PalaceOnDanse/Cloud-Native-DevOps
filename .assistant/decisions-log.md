# Decisions log

Running record of the choices that are too small for an ADR but worth remembering: what was
decided and why. Newest entries at the bottom. A choice that shapes the architecture gets an ADR
in `docs/adr/` and a one-line pointer here.

Format: `YYYY-MM-DD — what was decided — why (the trade-off)`.

Never rewrite history: if a choice is reversed, add a new line that says so.

2026-10-22 — GCP chosen as the cloud provider (not AWS) — the team decided to use GCP; the subject allows either and covers both.
2026-10-22 — Local tooling pinned with mise — see ADR-0001
2026-10-22 — Node 22 pinned as the runtime of the documentation check — scripts/check-docs.mjs needs it; the function runtime is a separate, undecided choice
2026-10-22 — tflint chosen for Terraform linting — see ADR-0002
2026-10-22 — gitleaks chosen for secret scanning — see ADR-0003
2026-10-22 — Terraform: three root stacks, per-environment backend and tfvars, no workspaces — see ADR-0004
2026-10-22 — Functions and frontend in TypeScript on Node.js — see ADR-0005
2026-10-22 — API Gateway, Cloud Run functions and Pub/Sub for the entry path — see ADR-0006
2026-10-22 — Grid stored as Firestore pixels with Cloud Storage tiles — see ADR-0007
2026-10-22 — Real-time updates through Firestore listeners — see ADR-0008
2026-10-22 — Firebase Hosting and Discord OAuth2 with Firebase custom tokens — see ADR-0009
2026-10-22 — Native GCP observability with OpenTelemetry — see ADR-0010
