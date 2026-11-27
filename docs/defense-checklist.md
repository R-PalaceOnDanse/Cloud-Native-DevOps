# Defense deliverables checklist (§5.6, Issue #94)

Each item of subject §5.6 has a status and the place where the evidence is. The grade is judged on
**prd, the repository and the defense** (§5.6).

Status values:

- **done**: in the code and its controls are in place;
- **needs live check**: in the code, to be verified on prd before the defense;
- **open decision**: the team must choose;
- **gap**: known shortfall, to fix or to explain.

Reviewed against `main` plus three pull requests:

- #176: discord-proxy publishes, plus Cloud Trace spans;
- #177: Firebase Hosting;
- #178: snapshot-notifier.

| # | §5.6 item | Status | Evidence | Live check before the defense |
|---|---|---|---|---|
| 1 | Group locked on the Intranet, private repo, GPG-signed commits | Signed commits: **done** (enforced). Private repo: **open decision** (below). Intranet: needs live check | Ruleset `protect-main` requires signed commits on `main` (*Settings > Rules > Rulesets*); signing setup in [development.md](development.md#commit-and-tag-signing) | GitHub reports 24 unverified commits out of 197 on `main`, all older than the ruleset; be ready to explain them. Intranet group locked: not visible from the repository |
| 2 | Two environments (dev, prd), instructor granted read access | done; needs live check | Projects `teampasx-cloudnative-dev` / `-prd` ([environments.md](environments.md)); `infra/access/members.tf`: instructor `roles/editor` on both projects + `roles/billing.viewer` on the billing account, as subject §1.3 / C01 §4.3 require; the GitHub account Kloox has read access on the repository | The instructor can open both projects and the billing report |
| 3 | Foundation (network, IAM, cluster, runners) deployed by Terraform + Helm via CI/CD | done; needs live check | `infra/foundation/*.tf` (VPC, subnet + secondary ranges, router, NAT, private GKE, `system-pool`, `runner-pool`, ARC, ESO, Grafana); `.github/workflows/terraform-deploy.yml` applies it on a tag (`foundation-dev`, `foundation-prd`) | Last `terraform-deploy` run green; `kubectl get pods -A \| grep -E 'arc-systems\|arc-runners\|external-secrets\|monitoring'` all Running in prd. Note: [environments.md](environments.md) still holds the inventory of 2026-10-23 ("not applied yet" for the Helm releases); it is stale |
| 4 | OIDC / Workload Identity in place; no long-lived cloud keys in GitHub | done | `infra/access/main.tf` (pool `github`, provider `github-actions`, `github-plan`, `github-apply`); `.github/actions/terraform-init`; `frontend-deploy.yml` deploys Hosting with the same credentials (no `FIREBASE_TOKEN`); `auth-check.yml`; ESO and Grafana use GKE Workload Identity | Run `auth-check`: 4 positive and 3 refusal jobs green. *Settings > Secrets and variables*: no GCP key (the workflows reference only `DISCORD_APPLICATION_ID` and `DISCORD_BOT_TOKEN`) |
| 5 | Runners scale via node autoscaling | done in dev; needs live check in prd | `gke.tf` (`runner-pool` Spot, 0..`runner_node_max_count` = 2, taint), `helm-arc.tf` (`minRunners 0`, `maxRunners` 2), `runner-load-test.yml`, `scripts/watch-runner-scaling.sh`, `docs/evidence/runner-scaling-dev.csv`, [runner-auto-scaling-demo.md](runner-auto-scaling-demo.md); alert `{vpc}-runner-jobs-waiting` | `runner-load-test` with `runner=arc-prd`: nodes 0 -> 2 -> 0. `RUNNER_LABEL` set so the PR checks run on `arc-*` (§5.3 "runners up and used") |
| 6 | Serverless app deployed by IaC via CI/CD: API Gateway, proxies, queues, workers, NoSQL, buckets | done; needs live check | `infra/serverless`: `gateway.tf` + `openapi.yaml.tftpl`, `function_*.tf` (6 functions, images in Artifact Registry `functions`), `pubsub.tf` (`pixel-draw-events`, `snapshot-ready`, DLQs, push subs, bucket notification), `firestore.tf` + rules, `bucket_snapshots.tf`, `secrets.tf`, `firebase.tf` (incl. `google_firebase_hosting_site.default`). Release: `serverless-{env}` then `frontend-{env}` (`frontend-deploy.yml`) | Last release green through `frontend-prd`; `https://teampasx-cloudnative-prd.web.app` serves the current build |
| 7 | Discord bot with all mandatory commands, signature validation, async processing | done; needs live check | Commands `/draw`, `/get`, `/snapshot`, `/admin pause\|resume\|clear\|ratelimit` in `scripts/register-discord-commands.mjs`. `discord-proxy` (`index.ts`, `interaction.ts`): Ed25519 check, publish to `pixel-draw-events`, deferred answer (type 5), ephemeral error on bad input or failed publish (tests `proxy.test.ts`, `signature.test.ts`). Worker handlers in `draw-worker/src/index.ts`. Snapshot: object metadata -> `OBJECT_FINALIZE` -> `snapshot-ready` -> `snapshot-notifier` -> signed URL 1 h | In the prd guild, every command shows the deferred answer, then the edited result. `/snapshot` gets "being prepared", then the signed link. A non-admin `/admin` is refused |
| 8 | Real-time serverless frontend, brush tool, large-grid performance, Discord OAuth2 | done; needs live check | `app/frontend/src`: `firestore-provider.ts` (`onSnapshot` per chunk + `config/system`), `viewport.ts` / `canvas.ts` / `minimap.ts` (10 000 x 10 000 grid), `brush.ts` (stroke refused whole, never truncated), `auth.ts` + `auth-callback` (Discord OAuth2 -> Firebase custom token). Hosted on Firebase Hosting (`app/frontend/firebase.json`) | On `https://teampasx-cloudnative-prd.web.app`: sign in with Discord, a draw in one window appears in the other, no polling in DevTools, zooming over the whole grid stays smooth |
| 9 | Monitoring, logging, tracing, alerting for cluster and app; scaling demonstrable | done as code; needs live check | Cluster: `infra/foundation/monitoring.tf` (dashboard `{vpc}-gke-overview`, 5 alerts), Grafana (`dashboards/cluster.json`, `serverless.json`), Managed Prometheus `arc-metrics`. App: `infra/serverless/dashboards.tf`, `alerts.tf` (5xx rate, both DLQs, backlog age). Logs: structured JSON with `correlationId` and trace fields. Traces: one span per function via the Cloud Trace API v2 (`src/trace.ts` in discord-proxy, web-draw-proxy, draw-worker, snapshot-notifier), same trace ID end to end. Load: `tests/load/burst-load.mjs`, [load-testing.md](load-testing.md) | Load test on prd: `draw-worker` instances and the Pub/Sub backlog on the app dashboard. A `/draw` and a `/snapshot` each show as one trace with parent and child spans. Fire the DLQ alert once (demo script, 24:00) and confirm the e-mail |
| 10 | Maintained provider-specific architecture diagram and internal documentation | done | [architecture.drawio](architecture.drawio) (GCP shapes, foundation + serverless, protocols, IAM boundaries), [architecture.md](architecture.md) (Mermaid + flows); [security-walkthrough.md](security-walkthrough.md); [defense-demonstration-script.md](defense-demonstration-script.md); `docs/adr/` (0001 to 0021); [infra.md](infra.md), [serverless.md](serverless.md), [ci.md](ci.md) | Export `docs/architecture.png` from diagrams.net and check the layout visually |

## Open decision: repository visibility

Subject §1.2 asks for a **private** repository. The repository is **public**, in an organization on
GitHub's free plan. That is what makes the ruleset `protect-main` and the required reviewers of the
`prd` environment enforced: on the free plan they are not enforced on a private repository. The
options:

1. **Make it private and keep the free plan.** This meets §1.2 but loses the ruleset (PR, review,
   signed commits, gitleaks required) and the prd reviewers. We would fall back to the previous
   guards: `check-tag`, the environment-bound apply account, the destroy confirmation.
2. **Make it private and move the organization to GitHub Team**, for example through GitHub
   Education. This meets §1.2 and keeps the ruleset and the reviewers. It depends on getting the
   plan in time.
3. **Stay public.** The controls stay enforced. We explain the trade-off at the defense, and accept
   the risk of a deduction on §1.2.

Whichever option the team chooses, record it in an ADR and update this line.

## Also expected at the defense (§5.2, §5.3)

| Expectation | Status | Where |
|---|---|---|
| prd live and reachable | needs live check | `$GW` and `https://teampasx-cloudnative-prd.web.app` |
| Full flow IDE -> PR -> review -> release -> deploy | done; rehearse | [defense-demonstration-script.md](defense-demonstration-script.md), 0:00 to 8:00, including the prd approval |
| Branch protection | done: ruleset `protect-main`, prd environment reviewers (while the repository is public) | [security-walkthrough.md](security-walkthrough.md#4-repository-and-workflow-controls) |
| Every member can explain the whole system | rehearse | [defense-rehearsal.md](defense-rehearsal.md), [defense-team-roles.md](defense-team-roles.md) |
| Each member: microphone, camera, stable connection, screen sharing | check the day before | §5.1 |
