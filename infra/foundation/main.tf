resource "google_compute_network" "main" {
  name                    = var.vpc_name
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "subnet_k8s" {
  name                     = "${var.vpc_name}-subnet"
  network                  = google_compute_network.main.id
  ip_cidr_range            = var.subnet_cidr
  region                   = var.region
  private_ip_google_access = true

  secondary_ip_range {
    range_name    = "pods-range"
    ip_cidr_range = var.pods_cidr
  }

  secondary_ip_range {
    range_name    = "services-range"
    ip_cidr_range = var.services_cidr
  }
}

moved {
  from = google_compute_subnetwork.main
  to   = google_compute_subnetwork.subnet_k8s
}

resource "google_compute_router" "router" {
  name    = "${var.vpc_name}-router"
  network = google_compute_network.main.id
  region  = var.region
}

resource "google_compute_router_nat" "nat" {
  name                               = "${var.vpc_name}-nat"
  router                             = google_compute_router.router.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}
