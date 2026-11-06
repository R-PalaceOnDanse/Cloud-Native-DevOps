resource "google_container_cluster" "primary" {
  name     = "${var.vpc_name}-gke"
  location = "${var.region}-b"

  network    = google_compute_network.main.id
  subnetwork = google_compute_subnetwork.subnet_k8s.id

  remove_default_node_pool = true
  initial_node_count       = 1

  deletion_protection = false

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods-range"
    services_secondary_range_name = "services-range"
  }

  depends_on = [
    google_project_service.container,
    google_project_service.compute,
  ]
}
