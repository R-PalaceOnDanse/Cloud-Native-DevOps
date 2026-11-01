resource "google_container_cluster" "primary" {
  name     = "${var.vpc_name}-gke"
  location = var.region

  network    = google_compute_network.main.id
  subnetwork = google_compute_subnetwork.subnet_k8s.id

  # Remove the default node pool immediately to keep an unmanaged cluster shell
  # (A dedicated node pool with autoscaling will be created in issue #70)
  remove_default_node_pool = true
  initial_node_count       = 1

  # Allow Terraform to destroy the cluster without manual intervention
  deletion_protection = false

  # Private nodes: no public IP addresses on nodes
  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  # Secondary IP ranges for pods and services in VPC-native cluster
  ip_allocation_policy {
    cluster_secondary_range_name  = "pods-range"
    services_secondary_range_name = "services-range"
  }

  depends_on = [
    google_project_service.container,
    google_project_service.compute,
  ]
}
