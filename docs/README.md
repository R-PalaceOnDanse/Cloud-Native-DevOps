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
| [development.md](development.md) | How to set up the local tooling and what the commit hooks run | `.mise.toml` `mise.lock` `.githooks/` `.tflint.hcl` | a tool, version, task or hook changes |
| [infra.md](infra.md) | How the Terraform code is laid out, where the environment values live, and how to plan it | `infra/` | a stack, an environment value, a rule about regions or state, or the run commands change |
| [discord.md](discord.md) | What the Discord application is, which values are public or secret and where they live, what remains to configure | the Discord application and its secrets | the application, its scopes, its secrets or its endpoint change |
| [environments.md](environments.md) | What exists in each GCP project, what Terraform manages and what it does not | `infra/access/` | a stack is applied or destroyed, or something is created by hand in a project |
| [functions.md](functions.md) | How the TypeScript functions workspace is laid out, its conventions, and how to build, lint and test it | `app/` `.github/workflows/functions-ci.yml` | a function, a command, a tool, a convention or the workflow changes |
| [data-model.md](data-model.md) | The rules of the pixel grid: tiles, identifiers, colors, rate limit and tile images, and what is not built yet | `app/functions/src/grid/` `app/functions/src/ratelimit/` `app/functions/src/render/` | a grid rule, a palette color, the rate limit or the tile rendering changes |
| [events.md](events.md) | The events on the broker, their envelope, the correlation ID and the log format | `app/functions/src/events/` | an event type, a payload, an attribute or the log format changes |
| [ci.md](ci.md) | How the infrastructure is checked, released and destroyed by the three GitHub Actions workflows of the subject, their variables, their known limits and what to extend | `.github/workflows/terraform-ci.yml` `.github/workflows/terraform-deploy.yml` `.github/workflows/terraform-destroy.yml` | a workflow, a variable, a limit or the release procedure changes |
| [adr/](adr/) | Why the structural choices were made | decisions | a structural decision is made or reversed |
| [decisions-log.md](../.assistant/decisions-log.md) | Smaller choices and their reasons | decisions | a smaller choice is made |
| [lessons.md](../.assistant/lessons.md) | Mistakes made and what now prevents them | lessons | review, CI or the user catches a mistake |
| [README.md](README.md) | This index and the documentation tooling | `scripts/check-docs.mjs` `.github/workflows/docs-check.yml` | the docs check or its workflow changes |
