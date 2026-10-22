# Development setup

How to get the same local tooling as the rest of the team. Read by every contributor, once per
clone.

## Prerequisites

- Linux, macOS or WSL2.
- [mise](https://mise.jdx.dev/getting-started.html), installed and activated in your shell.
- Git, with your GPG key configured to sign commits (see the subject, section 1.2).

## Setup

```bash
mise run setup
```

This installs the tools pinned in `.mise.toml` and sets `core.hooksPath` to `.githooks`.

| Tool | Version in `.mise.toml` | Used for |
|---|---|---|
| Node | 22 | documentation check, and tooling scripts |
| Terraform | 1.9 | infrastructure as code |
| gcloud | latest | GCP access and authentication |
| kubectl | 1.31 | GKE access |
| Helm | 3.16 | runners and cluster charts |
| tflint | 0.53 | Terraform linting |
| gitleaks | 8.21 | secret scan before each commit |

`.mise.toml` is the only place where versions are defined; change a version there, in a pull
request, never on one machine only. Versions are prefixes, so two machines can resolve different
patch releases until a lockfile is committed.

## Commit hooks

`.githooks/pre-commit` runs, in order: the documentation check (`node scripts/check-docs.mjs`),
`terraform fmt -check -recursive` when the repository has `.tf` files, and `gitleaks` on the
staged changes. A missing `terraform` or `gitleaks` is skipped with a warning, so run
`mise run setup` first. `.githooks/commit-msg` enforces Conventional Commits.

## Checks

```bash
mise run check    # documentation check
```

## Unknown

- Whether the team wants a devcontainer: only added if a teammate prefers to install nothing.
- Pinned patch versions: this setup was written without running mise; `mise install` has not yet
  been verified on a clean machine. Whoever runs it first should report problems and commit
  `mise.lock` (`mise lock`) if it works.
