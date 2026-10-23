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
2026-10-23 — Discord bot token and OAuth2 client secret go to Secret Manager, as empty secrets created by Terraform and filled by hand with gcloud — the values then never enter the Terraform state or the repository; see docs/discord.md
2026-10-23 — GitHub Actions authenticates through Workload Identity Federation defined in the access stack, with a read-only plan identity and an environment-scoped apply identity — see ADR-0011
2026-10-23 — Functions workspace uses npm, Vitest and ESLint with typescript-eslint (strict, no explicit any) — npm ships with Node so the team installs nothing new, Vitest runs TypeScript ES modules with no extra configuration, and ESLint enforces the no-any rule; see docs/functions.md
2026-10-23 — The functions keep Node 22 as their runtime, as pinned in .mise.toml — Cloud Run functions list Node.js 22, so no bump was needed to follow ADR-0005
2026-10-23 — One envelope for all events: identifying fields as Pub/Sub attributes and the payload as JSON data, hand-written validation with no schema library, and a correlation ID that is a UUID created by the proxy or a caller-supplied value of the form [A-Za-z0-9._-]{8,64} — keeps filtering possible without parsing the payload and keeps log injection out; see docs/events.md
2026-10-23 — The color palette is 16 named colors plus any #rrggbb, stored as lowercase #rrggbb — the subject accepts "hex or palette value"; a fixed palette lets a Discord user pick a color without knowing a hex code; see docs/data-model.md
2026-10-23 — The rate limit uses fixed one-minute windows and accepts or refuses a whole brush stroke — the state stays two numbers and a stroke is never cut in the middle; the cost is that a user can use the limit twice around a minute boundary; see docs/data-model.md
2026-10-23 — Tile PNGs are encoded in-house on Node's zlib instead of with an image library — the images are flat 8-bit RGB, so about sixty lines replace a native dependency to install, update and audit; see docs/data-model.md
2026-10-23 — The proxy defers every accepted command (response type 5, visible to all) and turns /draw into a pixel.draw event and every other command into a discord.command event — Discord needs an answer within 3 seconds; the worker that knows the outcome edits it; only /draw is a pixel write, the rest are commands to interpret; see docs/discord.md
2026-10-23 — Errors the user can fix (bad /draw, publish failure) are answered with a private message, not a public one — keeps failures out of the channel; see docs/discord.md
2026-10-23 — Slash commands are registered by bulk overwrite and are not hidden from non-admins in Discord — overwrite makes registration idempotent and removes deleted commands; admin rights are checked in the worker, so a Discord-side setting would only give false assurance and would hide /snapshot from allow-listed users; see docs/discord.md
2026-10-23 — The pipelines read six repository variables (provider, plan account and apply account for dev and prd) instead of environment variables — the plan job runs without a GitHub environment and a job can only read the variables of its own environment; the values are not secrets; see docs/ci.md
2026-10-23 — Pull request plans run with -lock=false — a plan only reads, and two pull requests must be able to plan together without failing on the state lock; see docs/ci.md
2026-10-23 — The access stack is planned by the pipeline but applied by hand — it is the identity the pipeline runs with, so a pipeline that applied it could lock itself out; see ADR-0012
2026-10-23 — tflint also runs in the pre-commit hook, on each stack, when tflint is installed — completes the follow-up of ADR-0002
2026-10-23 — The by-hand federation in dev (pool github-actions and account github-terraform-dev) was deleted once auth-check proved the access stack works in both projects — two federations did the same job and only one is reproducible; restorable for 30 days; see docs/environments.md
