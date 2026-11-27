project_id    = "teampasx-cloudnative-dev"
region        = "europe-west1"
vpc_name      = "teampasx-dev-vpc"
subnet_cidr   = "10.10.0.0/24"
pods_cidr     = "10.11.0.0/16"
services_cidr = "10.12.0.0/20"
environment   = "dev"
alert_emails = [
  "aurelienbara13@gmail.com",
  "nicolaslouis320@gmail.com",
  "quaduval@gmail.com",
]

# Cost safeguards of the runners (docs/infra.md#cost-safeguards).
runner_node_max_count = 2
runner_max_count      = 2

# ARC authenticates with the token in arc-github-token until the GitHub App secrets have values (#151).
runner_auth_type = "token"
