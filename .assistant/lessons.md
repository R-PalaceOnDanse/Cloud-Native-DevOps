# Lessons

Mistakes made on this project (by a person or an AI agent) and what now prevents them. Read it
before starting work; add to it whenever review, CI or the user catches something.

Each entry: `YYYY-MM-DD — what went wrong — how it was caught — what now prevents it`.
"What now prevents it" must be concrete: a test, a lint rule, a hook, a rule in `CLAUDE.md`, a
check in CI. An entry with no prevention is an open problem; say so.

2026-10-23 — Terraform was run with a version newer than the team's: the dev state was written by Terraform 1.17.0 while mise pins 1.9, and `required_version = ">= 1.9"` accepted both — found while reading the state during the review of PR #37 — `required_version = "~> 1.9.0"` now makes any other minor version fail at `init`, and `docs/infra.md` and the README say to use the mise-installed Terraform.
2026-10-23 — Two commits by one member were merged into `main` unsigned although the subject requires every commit to be Verified — found by checking GitHub's verification status of the history during the section 0 audit — nothing enforces it yet: requiring signed commits needs branch protection, which the free organization plan does not offer (#25). Open problem; until then each author checks that their first commit of a PR shows Verified.
2026-10-23 — `docs/infra.md` said the state buckets had versioning enabled; they do not — found by re-reading the bucket description with explicit fields while documenting their creation — the document now states what `gcloud storage buckets describe` returns and the creation steps turn versioning on. Facts about cloud resources are read from the resource itself, not from memory (CLAUDE.md rule 16).
