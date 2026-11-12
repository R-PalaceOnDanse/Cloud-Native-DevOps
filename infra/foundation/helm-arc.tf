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
  depends_on       = [google_container_node_pool.system]
}

resource "helm_release" "arc_runner" {
  name             = "arc-runner-set"
  namespace        = "arc-runners"
  create_namespace = true
  repository       = "oci://ghcr.io/actions/actions-runner-controller-charts"
  chart            = "gha-runner-scale-set"
  version          = "0.9.3"
  depends_on       = [helm_release.arc_controller]

  values = [
    file("values/runners-${var.environment}.yaml")
  ]

  set {
    name  = "githubConfigUrl"
    value = "https://github.com/R-PalaceOnDanse/Cloud-Native-DevOps"
  }

  # The secret is created by hand in the cluster, so the token never goes through Terraform.
  set {
    name  = "githubConfigSecret"
    value = "arc-github"
  }
}