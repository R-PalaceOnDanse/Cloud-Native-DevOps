project_id    = "teampasx-cloudnative-dev"
region        = "europe-west1"
vpc_name      = "teampasx-dev-vpc"
subnet_cidr   = "10.10.0.0/24"
pods_cidr     = "10.11.0.0/16"
services_cidr = "10.12.0.0/20"
environment   = "dev"

# Cost safeguards of the runners (docs/infra.md#cost-safeguards).
runner_node_max_count = 2
runner_max_count      = 2
