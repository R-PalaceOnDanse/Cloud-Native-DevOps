# Architecture

How the code is organised and how its parts fit together. The *why* of each choice is in
[`adr/`](adr/); this page describes **what exists now**.

This document is kept true by whoever changes the structure, in the same change. Every path it
cites must exist (checked by `scripts/check-docs.mjs`). Sections are added when the thing they
describe exists, not before.

## 1. Layout

Built so far:

- the network of the foundation (VPC, subnets with GKE secondary ranges, Cloud Router, Cloud NAT,
  applied in dev and prd; see [ADR-0013](adr/0013-network-topology-and-ip-addressing.md)) and the access stack (applied);
- in the functions workspace, the code that needs no cloud to be tested: the Discord proxy
  (signature, PING, slash commands to events), the event envelope and logger, the grid rules (tiles,
  colors, rate limit decision, tile images) and the command definitions.

Nothing of the application is deployed yet: no function, no broker, no database. The rest is documentation
and tooling.

The flow the pieces are written for, from [ADR-0006](adr/0006-api-gateway-cloud-run-functions-pubsub.md),
is Discord → API Gateway → proxy → Pub/Sub → workers → Firestore and Cloud Storage. Only the proxy
and the shapes of the events, the grid and the images exist; see [functions.md](functions.md),
[discord.md](discord.md), [events.md](events.md) and [data-model.md](data-model.md).

```
infra/       Terraform stacks (docs/infra.md): foundation/ (VPC, subnets, NAT, routing), access/ (GitHub Actions federation)
app/         application code; today only functions/, the TypeScript workspace (docs/functions.md)
docs/        documentation, including the official subject (docs/subject/)
scripts/     documentation check (check-docs.mjs)
.assistant/  decisions log and lessons
.github/     PR and issue templates, docs-check workflow
.githooks/   commit-msg and pre-commit hooks
.claude/     agent settings, hooks and vendored skills
.mise.toml   pinned local tool versions and setup tasks (docs/development.md)
```

The stack `infra/serverless` and the application folder `app/frontend` come
from the subject's suggested layout and are added, and documented, in the change that creates each
of them.

## 2. Conventions in place

Conventional Commits and the documentation check are enforced by `.githooks/`; see `CLAUDE.md`.

## 3. Decisions

See [`adr/`](adr/) for the recorded decisions and `../.assistant/decisions-log.md` for smaller
ones.
