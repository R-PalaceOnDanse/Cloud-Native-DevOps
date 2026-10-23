# Documentation index

Every surface of this project — anything someone needs to know to build, run, test, ship, operate
or use it — has one document, listed here. A document is updated in the same change as what it
covers. What each kind of document must contain is described by the `project-sync` skill
(`doc-surfaces.md`).

The **Covers** column lists, in code spans, the paths a document describes. The docs check
(`scripts/check-docs.mjs`) uses it: a top-level folder, `Dockerfile`, compose file, CI pipeline,
`.env.example`, API contract, schema or migrations folder that no document covers is an error,
and a document whose covered paths keep changing without it is reported as possibly stale.

| Document | What it answers | Covers | Update when |
|---|---|---|---|
| [brief.md](brief.md) | What to build and why: purpose, scope, priorities, success criteria | the intent of the project | the scope, priorities or success criteria change |
| [subject/cloud-native-devops-iac-serverless.md](subject/cloud-native-devops-iac-serverless.md) | The official assignment, syllabus and course supports C00–C08 (read-only source) | `docs/subject/` | the school publishes a new version |
| [architecture.md](architecture.md) | How the code is organised and how its parts fit together | `docs/` `.assistant/` `.githooks/` `.claude/` | a module, folder, flow or convention is added, moved or removed |
| [../README.md](../README.md) | How to get started: install the tools, log in, plan the infrastructure, and the workflow | `README.md` | the setup steps or the workflow change |
| [development.md](development.md) | How to set up the local tooling and what the commit hooks run | `.mise.toml` `mise.lock` `.githooks/` | a tool, version, task or hook changes |
| [infra.md](infra.md) | How the Terraform code is laid out, where the environment values live, and how to plan it | `infra/` | a stack, an environment value, a rule about regions, state or budgets, or the run commands change |
| [adr/](adr/) | Why the structural choices were made | decisions | a structural decision is made or reversed |
| [decisions-log.md](../.assistant/decisions-log.md) | Smaller choices and their reasons | decisions | a smaller choice is made |
| [lessons.md](../.assistant/lessons.md) | Mistakes made and what now prevents them | lessons | review, CI or the user catches a mistake |
| [README.md](README.md) | This index and the documentation tooling | `scripts/check-docs.mjs` `.github/workflows/docs-check.yml` | the docs check or its workflow changes |
