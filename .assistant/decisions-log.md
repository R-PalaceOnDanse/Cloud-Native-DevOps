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
