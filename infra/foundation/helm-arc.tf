data "google_client_config" "default" {}

provider "helm" {
  kubernetes {
    host                   = "https://${google_container_cluster.primary.endpoint}"
    token                  = data.google_client_config.default.access_token
    cluster_ca_certificate = base64decode(google_container_cluster.primary.master_auth[0].cluster_ca_certificate)
  }
}

resource "helm_release" "arc_controller" {
  name             = "arc"
  namespace        = "arc-systems"
  create_namespace = true
  repository       = "oci://ghcr.io/actions/actions-runner-controller-charts"
  chart            = "gha-runner-scale-set-controller"
  version          = "0.9.3"
  depends_on = [
    google_container_node_pool.system,
    google_compute_router_nat.nat,
  ]

  # Switches on the Prometheus metrics of the controller and of the listeners: jobs waiting, runners
  # busy and registered. They are off by default.
  set {
    name  = "metrics.controllerManagerAddr"
    value = ":8080"
  }

  set {
    name  = "metrics.listenerAddr"
    value = ":8080"
  }

  set {
    name  = "metrics.listenerEndpoint"
    value = "/metrics"
  }
}

# Tells Managed Prometheus to scrape those metrics. A local chart, as for arc-secret: the custom
# resource does not exist yet when Terraform plans.
resource "helm_release" "arc_metrics" {
  name       = "arc-metrics"
  namespace  = "arc-systems"
  chart      = "${path.module}/charts/arc-metrics"
  depends_on = [helm_release.arc_controller]
}

resource "helm_release" "arc_runner" {
  name             = "arc-runner-set"
  namespace        = "arc-runners"
  create_namespace = true
  repository       = "oci://ghcr.io/actions/actions-runner-controller-charts"
  chart            = "gha-runner-scale-set"
  version          = "0.9.3"
  depends_on = [
    helm_release.arc_controller,
    helm_release.arc_secret,
    google_compute_router_nat.nat,
  ]

  values = [
    file("values/runners-${var.environment}.yaml")
  ]

  set {
    name  = "githubConfigUrl"
    value = "https://github.com/R-PalaceOnDanse/Cloud-Native-DevOps"
  }

  # The token never goes through Terraform: the arc-secret release copies it from Secret Manager.
  set {
    name  = "githubConfigSecret"
    value = "arc-github"
  }
}