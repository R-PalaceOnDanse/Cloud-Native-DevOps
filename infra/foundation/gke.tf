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

  cluster_autoscaling {
    autoscaling_profile = "OPTIMIZE_UTILIZATION"
  }
}

resource "google_container_node_pool" "system" {
  name       = "system-pool"
  cluster    = google_container_cluster.primary.id
  location   = google_container_cluster.primary.location
  node_count = 1

  node_config {
    machine_type = "e2-small"
    disk_size_gb = 20

    labels = {
      role = "system"
    }
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }
}

resource "google_container_node_pool" "runners" {
  name     = "runner-pool"
  cluster  = google_container_cluster.primary.id
  location = google_container_cluster.primary.location

  autoscaling {
    min_node_count = 0
    max_node_count = 2
  }

  node_config {
    machine_type = "e2-medium"
    disk_size_gb = 20
    spot         = true

    labels = {
      role = "runner"
    }

    taint {
      key    = "runner"
      value  = "true"
      effect = "NO_SCHEDULE"
    }
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }
}