project_id    = "teampasx-cloudnative-prd"
region        = "europe-west1"
vpc_name      = "teampasx-prd-vpc"
subnet_cidr   = "10.20.0.0/24"
pods_cidr     = "10.21.0.0/16"
services_cidr = "10.22.0.0/20"
environment   = "prd"
alert_emails = [
  "aurelienbara13@gmail.com",
  "nicolaslouis320@gmail.com",
  "quaduval@gmail.com",
]

# Cost safeguards of the runners (docs/infra.md#cost-safeguards).
runner_node_max_count = 2
runner_max_count      = 2
