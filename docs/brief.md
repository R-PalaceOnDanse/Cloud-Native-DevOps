# Brief

What this project is meant to be: the owner's statement of intent, and the source of truth for
*what* to build. `CLAUDE.md` says how to work, `architecture.md` says how it is built, this says
what for.

Keep it short. Changing the scope, the priorities or the success criteria is a decision: update
this file and record the change with the `adr-new` skill (a decisions-log line is enough for a
small one). Never edit it silently. The official assignment is
[the subject](subject/cloud-native-devops-iac-serverless.md) (syllabus, subject, and course
supports C00–C08); it is summarised here, not copied.

## Purpose

Design, build, document and defend a production-grade cloud-native platform on **GCP**, as the
Epitech module "Cloud Native: DevOps, IaC & Serverless". The team's own emphasis is a clear
infrastructure and clean code.

## Users

- The team of 3 students, who build and defend it.
- The instructor, who reviews both GCP environments, the repository and the oral defense.
- End users: Discord members drawing on a shared pixel canvas through slash commands or the web
  frontend.

## Scope

In scope:

- **Foundation**, as Terraform + Helm deployed by CI/CD in two environments (dev, prd): VPC and
  NAT, least-privilege IAM, human access in a separate stack, a GKE cluster with a node pool for
  runners, self-hosted GitHub Actions runners scaling through node autoscaling, OIDC/Workload
  Identity Federation, Secret Manager, GitHub environments and Kubernetes secrets.
- **GitFlow and CI/CD**: short-lived branches, reviewed PRs, immutable `main`, tagged releases
  that apply dev then prd, `terraform fmt`/`validate`/`plan`, manual destroy workflows, switching
  between GitHub-hosted and self-hosted runners, signed commits.
- **Serverless canvas**: API Gateway → proxy function → Pub/Sub → worker, Firestore and Cloud
  Storage only, one service account per function, HTTPS and secrets in Secret Manager.
- **Discord bot** (Interactions, Ed25519 signature validation): `/draw`, `/get`, `/snapshot`,
  `/admin pause|resume|clear|ratelimit`.
- **Data model**: grid of at least 10000×10000 (chunked), per-pixel color, author and timestamp,
  per-user rate limiting (default about 20 pixels/minute), consistency under concurrency.
- **Frontend**: serverless, Discord OAuth2, real-time updates without polling, performant on the
  full grid, pixel inspection, multi-pixel brush with configurable size.
- **Observability**: cluster and app metrics, logs, traces with a correlation ID, alerts, and a
  demonstrable scaling under load.
- A maintained GCP architecture diagram and internal documentation.

Out of scope:

- AWS, any VM or Kubernetes workload for the application (the cluster only hosts CI/CD runners),
  SQL or self-managed databases, a persistent Discord gateway SDK process.

## Priorities

1. A working, demonstrable, serverless and event-driven application in prd, deployed as code
   through CI/CD (grade D baseline), plus an architecture diagram that matches reality.
2. Security: least privilege, no long-lived keys, secrets management, signature validation.
3. Observability and demonstrated scalability (grades C to A).
4. Defense quality: every member can explain every part.

## Success criteria

Graded FAILED or D to A on the live prd environment, the repository and the oral defense. The
project cannot pass without an architecture diagram, a functional demo, or a team able to explain
its work. The deliverables checklist is in the subject (section 5.6).

## Constraints

- GCP only; two projects, dev and prd, with free credits claimed and budgets/alerts set.
- Private GitHub repository outside the Epitech organization; all commits GPG-signed and
  Verified; the instructor (`Kloox` on GitHub, `jeremie@jjaouen.com` as GCP Editor) is granted
  access.
- Everything is created through IaC and pipelines; nothing by hand in a console.
- After a destroy, no billable resource remains except the human-access stack.
- No AI during the oral defense; AI use before it is allowed if every part can be explained.
- Deadline: Unknown, the team can answer.

## Open questions

- GCP project IDs, team name and deadline (team).
- Technology choices for gateway, broker, runtime and language, frontend hosting and the
  observability stack (team; each recorded as an ADR).
