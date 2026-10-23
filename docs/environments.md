# Environments

Overview of the cloud environments, their purpose, isolation model, and GCP project details. Read
by anyone developing, deploying, or operating resources in the project.

The decision to isolate environments into distinct GCP projects is recorded in
[ADR-0004](adr/0004-terraform-layout-and-environments.md).

## Summary

| Environment | GCP Project ID | Project Number | Region | State Bucket | Subnet CIDR | VPC Name |
|---|---|---|---|---|---|---|
| **dev** | `teampasx-cloudnative-dev` | `812267599723` | `europe-west1` | `state_bucket_dev` (in `europe-west9`) | `10.10.0.0/24` | `teampasx-dev-vpc` |
| **prd** | `teampasx-cloudnative-prd` | `1024204425086` | `europe-west1` | `state_bucket_prd` (in `europe-west9`) | `10.20.0.0/24` | `teampasx-prd-vpc` |

The configuration files under `infra/foundation/` (`<env>.tfvars` and `backends/<env>.hcl`) remain
the single source of truth for Terraform.

## Environments

### Development (`dev`)

- **GCP Project ID**: `teampasx-cloudnative-dev`
- **Purpose**: Fast feedback loop, integration testing, deploying experimental branches, and validating CI/CD pipelines.
- **Access**: All three team members have Owner permissions; instructor (`jeremie@jjaouen.com`) has Editor access.
- **Isolation**: Completely separated from production resources, databases, Pub/Sub topics, and IAM roles.

### Production (`prd`)

- **GCP Project ID**: `teampasx-cloudnative-prd`
- **Purpose**: Stable production environment hosting the final pixel canvas and public Discord bot integrations.
- **Access**: Team members have Owner permissions; changes will be strictly applied through automated CI/CD pipelines (issues #32 and #33).
- **Isolation**: Production data and events never mix with development data. Subnet CIDRs are non-overlapping (`10.20.0.0/24` vs `10.10.0.0/24` in dev) to allow secure VPC peering if needed later.

## Working with environments

Switch active project in the Google Cloud CLI:

```bash
# Switch to dev
gcloud config set project teampasx-cloudnative-dev

# Switch to prd
gcloud config set project teampasx-cloudnative-prd
```

Inspect project metadata:

```bash
gcloud projects describe teampasx-cloudnative-dev
gcloud projects describe teampasx-cloudnative-prd
```

Planning infrastructure for an environment is detailed in [infra.md](infra.md).
