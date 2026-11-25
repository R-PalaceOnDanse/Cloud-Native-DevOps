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

  # Lets a Kubernetes service account act as a Google identity, with no key (ADR-0016).
  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  # Cloud Operations (Monitoring and Logging) with Managed Service for Prometheus (ADR-0010)
  monitoring_config {
    enable_components = [
      "SYSTEM_COMPONENTS",
      "APISERVER",
      "CONTROLLER_MANAGER",
      "SCHEDULER"
    ]
    managed_prometheus {
      enabled = true
    }
  }

  logging_config {
    enable_components = [
      "SYSTEM_COMPONENTS",
      "WORKLOADS",
      "APISERVER",
      "CONTROLLER_MANAGER",
      "SCHEDULER"
    ]
  }

  depends_on = [
    google_project_service.container,
    google_project_service.compute,
    google_project_service.monitoring,
    google_project_service.logging,
    google_compute_router_nat.nat,
  ]

  cluster_autoscaling {
    # Node auto-provisioning stays off: the autoscaler may only resize the node pools declared
    # in this file, so it can never create a new pool without a size limit.
    # OPTIMIZE_UTILIZATION removes empty nodes sooner than the default BALANCED profile.
    enabled             = false
    autoscaling_profile = "OPTIMIZE_UTILIZATION"
  }
}

resource "google_container_node_pool" "system" {
  name       = "system-pool"
  cluster    = google_container_cluster.primary.id
  location   = google_container_cluster.primary.location
  node_count = 1

  node_config {
    # e2-small was full (94% of its memory requested); Grafana needs room (ADR-0021).
    machine_type = "e2-medium"
    disk_size_gb = 20

    labels = {
      role = "system"
    }

    workload_metadata_config {
      mode = "GKE_METADATA"
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

  # Cost ceiling of the runner pool (docs/infra.md#cost-safeguards). The total_* limits count the
  # nodes of the whole pool, whatever the number of zones of the cluster. 0 lets the pool empty
  # itself when no job runs.
  autoscaling {
    total_min_node_count = 0
    total_max_node_count = var.runner_node_max_count
  }

  node_config {
    machine_type = "e2-medium"
    disk_size_gb = 20
    spot         = true

    labels = {
      role = "runner"
    }

    workload_metadata_config {
      mode = "GKE_METADATA"
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