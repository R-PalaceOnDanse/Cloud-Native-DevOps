# Cloud Native: DevOps, IaC & Serverless

Epitech module project, built by the team `teampasx` on Google Cloud (GCP): a Terraform + Helm
foundation (network, IAM, GKE with self-hosted GitHub Actions runners) and a serverless,
event-driven pixel canvas driven by a Discord bot and a real-time web frontend, in two
environments, `dev` and `prd`.

Status: the foundation's network (VPC, subnets, Cloud NAT) and private GKE cluster (system and autoscaling runner node pools) are deployed in `infra/foundation`. What is to be built is tracked in the GitHub issues, grouped by milestone.

## Get started

You need Linux, macOS or WSL2, Git, and a Google account that has access to the two GCP projects
(ask the repository owner).

**1. Clone the repository and enter it.**

```bash
git clone git@github.com:R-PalaceOnDanse/Cloud-Native-DevOps.git
cd Cloud-Native-DevOps
```

**2. Install mise**, the tool that installs the exact versions of Terraform, gcloud, kubectl, Helm,
Node, tflint and gitleaks used by the team ([why](docs/adr/0001-mise-for-local-tooling.md)), then
activate it in your shell (use `zsh` instead of `bash` if that is your shell):

```bash
curl https://mise.run | sh
echo 'eval "$(~/.local/bin/mise activate bash)"' >> ~/.bashrc
```

Open a new terminal. Do not install Terraform with `apt` or `snap`: you would get another version.

**3. Install the tools and activate the git hooks.**

```bash
mise run setup
terraform version     # must print Terraform v1.9.x
```

**4. Log in to Google Cloud**, once.

```bash
gcloud auth login
gcloud auth application-default login
```

**5. Check that everything works** by planning the dev network. Nothing is created.

```bash
terraform -chdir=infra/foundation init -reconfigure -backend-config=backends/dev.hcl
terraform -chdir=infra/foundation plan -var-file=dev.tfvars
```

Replace `dev` with `prd` for the other environment. The details, the rules about regions and
state, and how to change the code are in [docs/infra.md](docs/infra.md). The environments and their
GCP projects are detailed in [docs/environments.md](docs/environments.md).

**6. Check the documentation** (it also runs before every commit):

```bash
mise run check
```

## Work on the project

1. Pick an issue and create a branch from `main`. Never commit to `main`.
2. Commit with a [Conventional Commit](https://www.conventionalcommits.org/) message
   (`feat: …`, `fix: …`, `docs: …`), signed with your GPG key (see the subject, section 1.2).
   The git hooks reject a wrong message, a leaked secret, and a new part of the project that no
   document covers.
3. Update the documents that describe what you changed, in the same pull request.
4. Open a pull request that contains `Closes #<issue>`. It needs one approval from a teammate.

The full rules, including what an AI agent may do, are in [CLAUDE.md](CLAUDE.md).

## Repository layout

| Path | Content |
|---|---|
| `infra/` | Terraform stacks, see [docs/infra.md](docs/infra.md) |
| `docs/` | Documentation, starting at [docs/README.md](docs/README.md), and the official subject |
| `docs/adr/` | Architecture decision records |
| `.assistant/` | Decisions log and lessons learned |
| `scripts/` | Documentation check |
| `.githooks/` | Commit hooks, activated by `mise run setup` |
| `.mise.toml`, `mise.lock` | Pinned tool versions |

## Troubleshooting

- **`terraform: command not found`** (or another tool): mise is not activated in your shell. Do
  step 2 again and open a new terminal. `mise exec -- terraform version` works without activation.
- **`Error acquiring the state lock`**: someone is running Terraform, or a run was interrupted.
  Ask the team before running `terraform force-unlock`.
- **`Error 403` on the state bucket or the project**: your Google account does not have access, or
  `gcloud auth application-default login` was not done.
- **A commit is refused**: read the message. The hook names the problem (commit message format,
  documentation check, secret found). Do not bypass the hook.
