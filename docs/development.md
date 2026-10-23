# Development setup

How to get the same local tooling as the rest of the team. Read by every contributor, once per
clone.

## Prerequisites

- Linux, macOS or WSL2.
- [mise](https://mise.jdx.dev/getting-started.html), installed and **activated in your shell**.
  Without activation `mise install` works but the installed tools are not on your `PATH`.
- Git, with your GPG key configured to sign commits (see the subject, section 1.2).

## Setup

Install and activate mise once (replace `bash` and `.bashrc` for another shell), then set up the
clone. The step by step version is in the [README](../README.md#get-started).

```bash
curl https://mise.run | sh
echo 'eval "$(~/.local/bin/mise activate bash)"' >> ~/.bashrc
mise run setup
```

`mise run setup` installs the tools pinned in `.mise.toml` and sets `core.hooksPath` to
`.githooks`. Open a new terminal after activating mise.

If a tool is reported as `command not found`, mise is not activated: check that `~/.bashrc`
contains the `mise activate` line. `mise exec -- <command>` runs a command with the pinned tools
without activation. Do not install the tools with `apt` or `snap`, which give other versions.

## Tools

| Tool | Version in `.mise.toml` | Required by the subject | Why it is here | Where it runs today | Decision |
|---|---|---|---|---|---|
| [mise](https://mise.jdx.dev/) | not pinned (install it yourself) | no | pins and installs every other tool | `mise run setup` | [ADR-0001](adr/0001-mise-for-local-tooling.md) |
| [Terraform](https://developer.hashicorp.com/terraform) | 1.9 | yes (IaC for foundation and serverless) | provisions all GCP resources | `terraform fmt -check` in the pre-commit hook once `.tf` files exist | mandated by the subject |
| [gcloud](https://cloud.google.com/sdk/docs) | latest (exact release in `mise.lock`) | yes (GCP is our provider) | GCP login, project selection, cluster credentials | manually | mandated by the provider choice (decisions log, 2026-10-22) |
| [kubectl](https://kubernetes.io/docs/reference/kubectl/) | 1.31 | yes (managed Kubernetes cluster) | inspect and debug the GKE cluster and runners | manually | mandated by the subject |
| [Helm](https://helm.sh/docs/) | 3.16 | yes (runners deployed with Helm) | deploys the self-hosted runners and other charts | manually | mandated by the subject |
| [Node](https://nodejs.org/) | 22 | no | runs `scripts/check-docs.mjs`, the documentation check | pre-commit hook, `mise run check`, docs-check workflow | decisions log, 2026-10-22 |
| [tflint](https://github.com/terraform-linters/tflint) | 0.53 | no | catches Terraform mistakes that `validate` misses | the pre-commit hook only; not in CI yet ([ci.md](ci.md#what-to-extend)) | [ADR-0002](adr/0002-tflint-for-terraform-linting.md) |
| [gitleaks](https://github.com/gitleaks/gitleaks) | 8.21 | no (the subject forbids committed secrets) | blocks secrets before they are committed | pre-commit hook | [ADR-0003](adr/0003-gitleaks-for-secret-scanning.md) |

The versions of the tools mandated by the subject are only starting points: the subject does not
dictate a version, so any bump is a normal pull request.

`.mise.toml` is the only place where versions are defined; change a version there, in a pull
request, never on one machine only. Versions are prefixes; `mise.lock` pins the exact release
(for example Terraform 1.9.8, gcloud 590.0.0) and its checksums for every platform. After
changing `.mise.toml`, run `mise lock` and commit `mise.lock` with it.

## Commit hooks

`.githooks/pre-commit` runs, in order: the documentation check (`node scripts/check-docs.mjs`),
`terraform fmt -check -recursive` and `tflint` on each stack when the repository has `.tf` files, and
`gitleaks` on the staged changes. A missing `terraform` or `gitleaks` is skipped with a warning, so run
`mise run setup` first. `.githooks/commit-msg` enforces Conventional Commits.

## Checks

```bash
mise run check    # documentation check
```

## Unknown

- Whether the team wants a devcontainer: only added if a teammate prefers to install nothing.
- `mise install` was verified on one Linux (WSL2) machine only; macOS is untested.
