output "vpc_id" {
  value       = google_compute_network.main.id
  description = "ID of the VPC network."
}

output "subnet_id" {
  value       = google_compute_subnetwork.main.id
  description = "ID of the subnet."
}

output "router_name" {
  value       = google_compute_router.router.name
  description = "Name of the Cloud Router."
}

output "nat_name" {
  value       = google_compute_router_nat.nat.name
  description = "Name of the Cloud NAT gateway."
}

output "pods_range_name" {
  value       = "${var.vpc_name}-pods"
  description = "Name of the secondary IP range for GKE pods."
}

output "services_range_name" {
  value       = "${var.vpc_name}-services"
  description = "Name of the secondary IP range for GKE services."
}

