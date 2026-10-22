# Architecture

How the code is organised and how its parts fit together. The *why* of each choice is in
[`adr/`](adr/); this page describes **what exists now**.

This document is kept true by whoever changes the structure, in the same change. Every path it
cites must exist (checked by `scripts/check-docs.mjs`). Sections are added when the thing they
describe exists, not before.

## 1. Layout

Nothing is built yet: the repository holds documentation and tooling only.

```
docs/        documentation, including the official subject (docs/subject/)
scripts/     documentation check (check-docs.mjs)
.assistant/  decisions log and lessons
.github/     PR and issue templates, docs-check workflow
.githooks/   commit-msg and pre-commit hooks
.claude/     agent settings, hooks and vendored skills
.mise.toml   pinned local tool versions and setup tasks (docs/development.md)
```

The intended target layout comes from the subject (`infra/access`, `infra/foundation`,
`infra/serverless`, `app/functions`, `app/frontend`). It is a suggestion, not a decision: each
folder is added, and documented, in the change that creates it.

## 2. Conventions in place

Conventional Commits and the documentation check are enforced by `.githooks/`; see `CLAUDE.md`.

## 3. Decisions

See [`adr/`](adr/) for the recorded decisions and `../.assistant/decisions-log.md` for smaller
ones.
