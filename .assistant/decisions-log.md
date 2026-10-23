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
2026-10-23 — Every regional resource goes in europe-west1 (Belgium), in both environments — API Gateway is not available in europe-west9, and one region avoids cross-region latency and cost; the existing state buckets stay in europe-west9 because a bucket location is immutable
2026-10-23 — Team name is teampasx and the prd project is teampasx-cloudnative-prd; state buckets are state_bucket_dev and state_bucket_prd — these are the resources that exist in GCP; ADR-0004 is amended
2026-10-23 — Terraform state prefix is the stack name (foundation), not the environment — one bucket per environment already separates dev and prd; the empty state under the old prefix dev/ was left in place
2026-10-23 — Subnets use non-overlapping ranges, 10.10.0.0/24 for dev and 10.20.0.0/24 for prd — keeps the environments peerable later
2026-10-23 — GitHub Actions authenticates through Workload Identity Federation defined in the access stack, with a read-only plan identity and an environment-scoped apply identity — see ADR-0011
2026-10-23 — Functions workspace uses npm, Vitest and ESLint with typescript-eslint (strict, no explicit any) — npm ships with Node so the team installs nothing new, Vitest runs TypeScript ES modules with no extra configuration, and ESLint enforces the no-any rule; see docs/functions.md
2026-10-23 — The functions keep Node 22 as their runtime, as pinned in .mise.toml — Cloud Run functions list Node.js 22, so no bump was needed to follow ADR-0005
