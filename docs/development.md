# Development setup

How to get the same local tooling as the rest of the team. Read by every contributor, once per
clone.

## Prerequisites

- Linux, macOS or WSL2.
- [mise](https://mise.jdx.dev/getting-started.html), installed and **activated in your shell**.
  Without activation `mise install` works but the installed tools are not on your `PATH`.
- Git, with your GPG or SSH key configured to sign commits (see [Commit and tag signing](#commit-and-tag-signing)).

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
| [tflint](https://github.com/terraform-linters/tflint) | 0.53 | no | catches Terraform mistakes that `validate` misses | installed only: not yet in the hook or CI | [ADR-0002](adr/0002-tflint-for-terraform-linting.md) |
| [gitleaks](https://github.com/gitleaks/gitleaks) | 8.21 | no (the subject forbids committed secrets) | blocks secrets before they are committed | pre-commit hook | [ADR-0003](adr/0003-gitleaks-for-secret-scanning.md) |

The versions of the tools mandated by the subject are only starting points: the subject does not
dictate a version, so any bump is a normal pull request.

`.mise.toml` is the only place where versions are defined; change a version there, in a pull
request, never on one machine only. Versions are prefixes; `mise.lock` pins the exact release
(for example Terraform 1.9.8, gcloud 590.0.0) and its checksums for every platform. After
changing `.mise.toml`, run `mise lock` and commit `mise.lock` with it.

## Commit and tag signing

Every commit and tag in this repository must be cryptographically signed and show as **Verified**
on GitHub (mandated by the subject §1.2 and C01 §3.2). Signatures using GPG or SSH keys are both
accepted.

### Option A: GPG key

1. **Generate a key** (choose RSA 4096 or ed25519) if you do not have one yet:

   ```bash
   gpg --full-generate-key
   ```

   Provide your full name and your verified GitHub email address (e.g. `firstname.lastname@epitech.eu`).

2. **List secret keys and retrieve your key ID** (the hex ID following the algorithm or the full fingerprint):

   ```bash
   gpg --list-secret-keys --keyid-format=long
   ```

3. **Export the public key and add it to GitHub**:

   ```bash
   gpg --armor --export <KEY_ID>
   ```

   Go to GitHub **Settings > SSH and GPG keys > New GPG key**, paste the exported block, and save.

4. **Configure Git to sign commits and tags by default**:

   ```bash
   git config --global user.signingkey <KEY_ID>
   git config --global commit.gpgsign true
   git config --global tag.gpgsign true
   ```

   On Windows, if `gpg` is not in your system `PATH`, specify Git's embedded GPG binary:

   ```bash
   git config --global gpg.program "C:\Program Files\Git\usr\bin\gpg.exe"
   ```

### Option B: SSH signing key

1. **Add your SSH key as a Signing Key on GitHub**:
   Go to GitHub **Settings > SSH and GPG keys > New SSH key**, choose **Key type: Signing Key**,
   and paste your public key (e.g. `cat ~/.ssh/id_ed25519.pub`).

2. **Configure Git to sign with SSH**:

   ```bash
   git config --global gpg.format ssh
   git config --global user.signingkey ~/.ssh/id_ed25519.pub
   git config --global commit.gpgsign true
   git config --global tag.gpgsign true
   ```

### Verification

Verify locally that signatures are valid on the latest commit:

```bash
git log --show-signature -1
```

Once pushed, check the commit on GitHub to verify that it carries the green **Verified** badge.

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
- `mise install` was verified on one Linux (WSL2) machine only; macOS is untested.
