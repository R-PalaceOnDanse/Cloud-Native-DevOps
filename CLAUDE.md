# CLAUDE.md

Operating guide for AI agents working in this repository. Read it first, every session. If it
conflicts with an older instruction, **this file and the documents it links win**.

## 1. Project

Epitech module "Cloud Native: DevOps, IaC & Serverless", built by a team of 3 on **GCP** with two
isolated environments (dev, prd). A Terraform + Helm **foundation** (network, IAM, GKE with
autoscaling self-hosted GitHub Actions runners, OIDC/Workload Identity) hosts the CI/CD, and a
100% serverless, event-driven **pixel canvas** (r/place style) is driven by a Discord bot and a
real-time web frontend. The focus is a clear infrastructure and clean code. So far only the
foundation's VPC and subnet exist (`docs/infra.md`).

- Brief — what to build, scope, priorities, success criteria: `docs/brief.md`. **Read it at the
  start of every session**; it is the source of truth for *what* to build.

## 2. Map

This file stays short. Details live in the documents below — link to them, do not copy them here.

| Topic | File |
|---|---|
| What to build: purpose, scope, priorities, success criteria | `docs/brief.md` |
| Official subject, syllabus and course supports C00–C08 (read-only source) | `docs/subject/cloud-native-devops-iac-serverless.md` |
| Index of all documentation: structure, interfaces, deployment, CI, tests, technologies… | `docs/README.md` |
| Environments and GCP projects (dev, prd) | `docs/environments.md` |
| Code structure and flows | `docs/architecture.md` |
| Decisions and their reasons | `docs/adr/` · `.assistant/decisions-log.md` |
| Mistakes already made, and what now prevents them | `.assistant/lessons.md` |

## 3. Hard rules

1. Never commit or push to `main`. Work on a branch and open a pull request that links its issue (`Closes #N`).
2. A pull request needs 1 approval(s) from someone other than its author before it is merged.
3. Commits follow Conventional Commits (`feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `ci`, `perf`, `build`).
4. Never add `Co-Authored-By` or "Generated with" lines to commits or pull requests; `.claude/settings.json` disables them and `.githooks/commit-msg` rejects them.
5. Never commit secrets, credentials or `.env` files; secrets come from the environment. Validate all external input at the boundary.
6. The skills in `.claude/skills/` are copies of the claude-project-kit; update them with the kit's `install.sh --project .` and do not edit them in place.
7. The documentation check (`node scripts/check-docs.mjs`) runs before every commit, and fails when a surface has no document; fix what it reports instead of bypassing it.
8. The documentation check also runs in CI.
9. Enable the git hooks once per clone with `git config core.hooksPath .githooks`; Claude Code refuses `git commit` until they are active.
10. Working mode: act freely on reversible changes; stop on structural or irreversible ones. The owner can override it for a given task.
11. Always ask before: adding a dependency, deleting files or data, schema migrations, changing CI or hooks, pushing, deploying or publishing, running `terraform apply` or `terraform destroy` (they spend real cloud credits).
12. Autonomy: without asking you may edit documentation, write ADRs and decision-log entries. Anything else that changes the repository or the outside world: ask first.
13. Code, commits and documentation are written in English.
14. Do what the task asks, nothing more.
15. Read a file fully before editing it.
16. Never state something about the code you have not verified in the code.
17. Documentation is part of done: a change is not finished until the documents that describe what it touched are updated, in the same change.
18. Everything that exists and that someone needs to build, run, test, ship, operate or use the project has one document, listed in `docs/README.md`. A new surface (interface, data model, service, technology, pipeline, environment, command, configuration variable) gets its document in the change that introduces it. Keep one home per fact: link, do not copy, and prefer a generated reference when the code is the source of truth.

## 4. Commands

```bash
mise run setup                        # once per clone: tools + git hooks (docs/development.md)
mise run check                        # documentation check (node scripts/check-docs.mjs)
npm --prefix app/functions ci         # functions: install (docs/functions.md)
npm --prefix app/functions run typecheck && npm --prefix app/functions run lint && npm --prefix app/functions test
```

## 5. Living documentation protocol

The documentation is part of the product. You are **authorised, and expected, to keep it
current without asking**, in the same change as the code. Decisions are not final: they can be
superseded, but never silently.

| When | Do |
|---|---|
| You start on this project with no prior context (a new session, or you are a sub-agent) | Run the `project-onboard` skill before the task; it only reads |
| You make or notice a structural choice (dependency, pattern, data model, boundary, tool, process) | Run the `adr-new` skill: an ADR if it is architectural, otherwise one dated line in `.assistant/decisions-log.md` |
| Your change adds, moves, removes or alters anything that exists in the project — a module, API, command, data model, event, configuration variable, service, technology, pipeline, environment, test setup, deployment step or user-visible behaviour | Update the document that covers it (find it in `docs/README.md`), or create it if the surface is new — the `project-sync` skill describes what each kind of document must contain — and keep the index true, in the same change |
| The scope, priorities or success criteria change (the user says so, or the work shows the brief is wrong) | Propose the change, update `docs/brief.md` once the user agrees, and record it with `adr-new`; never edit the brief silently |
| A document, rule or past decision turns out to be wrong or stale | Fix the document; for a decision, write a new ADR that supersedes the old one |
| A mistake was caught by review, CI or the user | Add an entry to `.assistant/lessons.md`; if it can be enforced, propose a test, lint rule or hook |
| Before opening a PR, and at the end of a work session | Run the `project-sync` skill and fix what it reports |

Describe only what exists. If you do not know, write it under *Open questions* and ask the
user — never guess into a document. Keep this file under about 100 lines.

## 6. Open questions

- Points each ADR (0004–0010) says to verify before implementing, for example Firebase Terraform support and raw-body forwarding by API Gateway (team).
- Teammates' GitHub handles and GPG setup; instructor access via `Kloox` (GitHub) and `jeremie@jjaouen.com` (GCP Editor) (team).
- Branch protection on `main` is not configured, so rule 1 is not enforced by GitHub (repository owner).
- Branch naming convention is not decided (team).
