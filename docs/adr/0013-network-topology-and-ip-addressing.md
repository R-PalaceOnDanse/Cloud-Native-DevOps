# ADR-0013 — Foundation network topology, VPC-native IP addressing and Cloud NAT egress

- **Status**: Accepted
- **Date**: 2026-10-23
- **Deciders**: project owner; team approval through pull request review
- **Supersedes**: none

## Context

The subject (§2.1, C02, C04) and issue #29 mandate provisioning the foundation network as code:
a dedicated VPC, subnets, NAT/egress, and routing in both `dev` and `prd` environments.

The network must accommodate a managed GKE cluster and self-hosted GitHub Actions runners
(section 2 issues), requiring:
1. A VPC-native cluster topology using alias IPs for Pods and Services.
2. Complete IP isolation between `dev` and `prd` without address overlap, allowing future VPC peering.
3. Private node egress: private GKE nodes and runners must pull container images and reach the
   public internet and GitHub without having public IP addresses assigned to VMs.
4. Access to Google APIs (Cloud Storage, Artifact Registry, Cloud Logging) without traversing
   the public internet.

## Options considered

1. **Auto-mode VPC** — Creates default subnets in all GCP regions with identical IP ranges in both
   environments. Refused: causes IP collisions, prevents VPC peering, and creates unneeded regional
   subnets.
2. **Custom-mode VPC with public node IPs** — Nodes get external IPs directly. Refused: violates
   least privilege and cloud security best practices by exposing cluster compute instances to the
   public internet.
3. **Custom-mode VPC with private subnets, secondary GKE ranges, Private Google Access, and Cloud NAT** —
   Private subnets with non-overlapping supernets per environment, secondary ranges for Kubernetes
   Pods and Services, and Cloud Router + Cloud NAT for egress.

## Decision

Option 3. In both `teampasx-cloudnative-dev` and `teampasx-cloudnative-prd`:

- **Custom VPC**: `google_compute_network` with `auto_create_subnetworks = false`.
- **Region**: `europe-west1` (Belgium), per the single-region rule ([ADR-0004](0004-terraform-layout-and-environments.md)).
- **Non-overlapping IP Plan**:
  - `dev` (`10.10.0.0/15` block):
    - Primary Node Subnet: `10.10.0.0/24` (256 addresses)
    - Pods Secondary Range: `10.11.0.0/16` (65,536 addresses)
    - Services Secondary Range: `10.12.0.0/20` (4,096 addresses)
  - `prd` (`10.20.0.0/15` block):
    - Primary Node Subnet: `10.20.0.0/24` (256 addresses)
    - Pods Secondary Range: `10.21.0.0/16` (65,536 addresses)
    - Services Secondary Range: `10.22.0.0/20` (4,096 addresses)
- **Private Google Access**: Enabled on both subnets (`private_ip_google_access = true`), allowing
  private instances to reach Google APIs through internal routing.
- **Egress NAT**: `google_compute_router` and `google_compute_router_nat` with:
  - `nat_ip_allocate_option = "AUTO_ONLY"`
  - `source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"` (covers primary and secondary ranges)
  - `log_config { enable = true, filter = "ERRORS_ONLY" }` for observability without log flood.

## Consequences

- Positive: Private, secure GKE cluster readiness; ample IP capacity for autoscaling runners and pods;
  zero CIDR overlap between dev and prd; fully reproducible and disposable via Terraform.
- Negative / trade-offs accepted: Cloud NAT carries an hourly fixed cost (~$0.045/hour per gateway,
  ~$32/month per environment). Both projects have 20 EUR monthly budget alerts with email notifications
  to guard against unintended usage.
- Teardown: `terraform destroy` removes all billable networking resources (Cloud NAT gateway, Cloud Router,
  Subnet, and VPC).
- Follow-up work: Issue #69 (Deploy GKE cluster) attaches node pools to the primary subnet and references
  `pods_range_name` and `services_range_name`.
