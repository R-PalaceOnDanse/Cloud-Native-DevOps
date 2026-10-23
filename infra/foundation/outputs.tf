output "vpc_id" {
  value       = google_compute_network.main.id
  description = "ID of the VPC network."
}

output "subnet_id" {
  value       = google_compute_subnetwork.main.id
  description = "ID of the subnet."
}
