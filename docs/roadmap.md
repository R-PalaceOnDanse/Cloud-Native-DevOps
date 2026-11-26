# Roadmap to the final delivery (26 → 30 November 2026)

Goal: everything the subject requires is live on **prd** by **Sunday 29 evening**, then the project is
**frozen**. Monday 30 is a buffer; the following days are for revising the project, not changing it.

Legend: 👤 Quentin · 🤖 Claude (with Quentin) · 🅰️ Aurélien · 🅻 Louis · ⛔ blocks what follows

---

## Phase 0 — Unblock the platform (Thursday 26, ~45 min) ⛔

| # | Task | Who | How |
|---|---|---|---|
| 0.1 | `github-plan@…-prd` may read the billing account | 👤 | `gcloud billing accounts add-iam-policy-binding 015B95-C1627B-339E15 --member="serviceAccount:github-plan@teampasx-cloudnative-prd.iam.gserviceaccount.com" --role="roles/billing.viewer"` |
| 0.2 | `arc-github-token` has a value in dev and prd | 👤 | `gcloud secrets versions list arc-github-token --project=<project>` → at least one `enabled` |
| 0.3 | Grafana admin password in dev and prd | 👤 | `openssl rand -base64 24 \| tr -d '\n' \| gcloud secrets versions add grafana-admin-password --data-file=- --project=<project>` |
| 0.4 | Review and merge #175 (ARC stays on the token) | 🅰️ or 🅻 review, 👤 merge | GitHub |
| 0.5 | Project-level Owner on prd for Aurélien and Louis | 👤 invite, 🅰️🅻 accept, 👤 import | Console → IAM → Grant access → *Propriétaire (ancien)*; then the two `terraform import` (see the conversation) |
| 0.6 | Check: `plan (access, prd)` shows *No changes* | 🤖 | rerun of terraform-ci |

> Cloud Shell rule, every time: the prompt shows the right project (`…-dev` / `…-prd`), and
> `terraform init -reconfigure -backend-config=backends/<env>.hcl` runs right before `plan`/`apply`
> with the **same** `<env>.tfvars`. Never `-lock=false`.

## Phase 1 — Missing code (Thursday 26 → Friday 27)

Work in parallel, one small PR each, reviewed by someone else within 2 hours.

| # | Task | Subject | Who | Issue |
|---|---|---|---|---|
| 1.1 | Discord proxy: deferred answer (type 5) and publish `discord.command` / `pixel.draw` to `pixel-draw-events` (worker already handles them) | §3.2 ⛔ | 🤖 | #44, #145 |
| 1.2 | Frontend hosting as code (Firebase Hosting) + deployment job on release, built with `terraform output -json frontend_build_env` | §3.4 ⛔ | 🅰️ | #168 |
| 1.3 | Discord portal: OAuth2 redirects `https://teampasx-cloudnative-{dev,prd}.web.app`; send Quentin the Application ID and the admins' Discord IDs | §3.2, §3.4 ⛔ | 🅰️ | #40 |
| 1.4 | GitHub secrets `DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN` (register-commands workflow) | §3.2 | 🅰️ | #49 |
| 1.5 | `discord_client_id` and `admin_user_ids` in `infra/serverless/{dev,prd}.tfvars` | §3.2 | 🤖 | — |
| 1.6 | Export real spans to Cloud Trace (proxy → worker, same trace ID) | §04 | 🤖 | #88 |
| 1.7 | Snapshot: bucket event → notifier function posting the signed URL | C07 §2 | 🅻 | #169 |
| 1.8 | Architecture diagram (GCP icons, flows, IAM boundaries, real-time path) | §5.2 ⛔ for the grade | 🅻 | #91 |

## Phase 2 — Release to dev and end-to-end tests (Friday 27)

| # | Task | Who |
|---|---|---|
| 2.1 | Signed tag `v0.4.0` on `main` → deploys foundation, serverless (and frontend once 1.2 is merged) to dev | 🤖 |
| 2.2 | Secret values in dev: `discord-client-secret`, `discord-public-key` | 🅰️ |
| 2.3 | Discord portal: *Interactions Endpoint URL* = `<gateway_url>/discord/interactions` (dev while testing) | 🅰️ |
| 2.4 | Run the `register-discord-commands` workflow | 🅰️ or 👤 |
| 2.5 | Test checklist, on dev (below) | 👤 + 🤖 |

**Test checklist** (each line must pass on dev, then again on prd):
- [ ] Web: Discord login, draw one pixel, brush, inspect a pixel (author + time)
- [ ] Real time: a pixel drawn in one browser appears in a second one, without refresh
- [ ] Discord: `/draw`, `/get`, `/snapshot` (signed link opens), `/admin pause|resume|clear|ratelimit`
- [ ] A normal user is refused on `/admin` and `/snapshot`; a paused canvas refuses web and Discord draws
- [ ] Rate limit: the 21st pixel within a minute is refused
- [ ] Gateway: `/draw` without token → 401; worker URL from the internet → 403
- [ ] Grafana (port-forward) shows the cluster and the application; one alert fires and the email arrives
- [ ] Logs Explorer finds a whole request by its correlation ID; Cloud Trace shows the trace (after 1.6)
- [ ] Load: `tests/load/burst-load.mjs` → functions scale, queue buffers and drains, runners scale nodes

## Phase 3 — Fixes from the tests (Saturday 28)

Only what the checklist found broken. Each fix: one PR, one review, one new tag on dev.

## Phase 4 — Production and freeze (Sunday 29) ⛔

| # | Task | Who |
|---|---|---|
| 4.1 | Secret values in prd (`discord-*`, already done for Grafana) | 🅰️ |
| 4.2 | Signed tag `v1.0.0` → dev then prd (approve the prd deployment in *Actions*) | 🤖, 👤 approves |
| 4.3 | Discord *Interactions Endpoint URL* → **prd** gateway (one Discord app has one URL: the defense uses prd) | 🅰️ |
| 4.4 | Test checklist again, on prd | 👤 + 🤖 |
| 4.5 | Evidence pack in `docs/evidence/`: scaling (runners + serverless), one trace, fired alerts, a PR → review → release → deploy run | 🅰️ | 
| 4.6 | Defense documents updated to the real system: demo script, security walk-through, deliverables checklist | 👤 (#92, #93, #94) |
| 4.7 | **Freeze**: no merge on `main` any more, except a fix for something broken on prd | everyone |

## Phase 5 — Buffer and preparation (Monday 30)

- Fix only what blocks the defense (prd down, a mandatory command broken).
- Knowledge transfer (#173): each owner presents their part to the two others; everyone can explain
  everything, infra and code.
- Rehearse the demo on prd (#95); check microphone, webcam, screen sharing.

---

## Housekeeping (anytime, no impact on the code)

- Close the superseded pull requests #154, #155, #156 (replaced by #174).
- Close the duplicate trackers #108–#123 that are not done yet once their work is (they mirror the epics #5–#11).
- Remove by hand, if wanted, the instructor binding and the budget left on the old billing account `01A021-589B0D-8ED8BC`.
- At the defense, own the 14 old unsigned commits: `main` now refuses unsigned commits.

## Known decisions

- ARC authenticates with the token until the GitHub App secrets are filled (#151, optional).
- The instructor's billing viewer is managed as code on the free-credit account `015B95-C1627B-339E15`.
- The Discord application points to prd for the defense; dev is tested before Sunday.
