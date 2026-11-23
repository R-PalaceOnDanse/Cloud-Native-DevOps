locals {
  # Created by the access stack (infra/access/grafana_secret.tf); the value is added by hand.
  grafana_secret_name     = "grafana-admin-password"
  grafana_namespace       = "monitoring"
  grafana_service_account = "grafana"
}

# Grafana reads Cloud Monitoring as its own Kubernetes service account, through Workload Identity:
# no Google account and no key (ADR-0017). Viewer only: it can read metrics, not change anything.
resource "google_project_iam_member" "grafana_monitoring_viewer" {
  project = var.project_id
  role    = "roles/monitoring.viewer"
  member  = "principal://iam.googleapis.com/projects/${data.google_project.this.number}/locations/global/workloadIdentityPools/${var.project_id}.svc.id.goog/subject/ns/${local.grafana_namespace}/sa/${local.grafana_service_account}"
}

# External Secrets Operator may read the admin password, and only that secret.
resource "google_secret_manager_secret_iam_member" "eso_reads_grafana_admin" {
  secret_id = "projects/${var.project_id}/secrets/${local.grafana_secret_name}"
  role      = "roles/secretmanager.secretAccessor"
  member    = "principal://iam.googleapis.com/projects/${data.google_project.this.number}/locations/global/workloadIdentityPools/${var.project_id}.svc.id.goog/subject/ns/${local.eso_namespace}/sa/${local.eso_service_account}"

  depends_on = [google_project_service.secretmanager]
}

# The store and the secret to copy, as a small local chart (same reason as arc-secret).
resource "helm_release" "grafana_secret" {
  name             = "grafana-secret"
  namespace        = local.grafana_namespace
  create_namespace = true
  chart            = "${path.module}/charts/grafana-secret"
  depends_on       = [helm_release.external_secrets]

  set {
    name  = "projectId"
    value = var.project_id
  }

  set {
    name  = "secretName"
    value = local.grafana_secret_name
  }
}

resource "helm_release" "grafana" {
  name             = "grafana"
  namespace        = local.grafana_namespace
  create_namespace = true
  # The chart moved to the community repository: the one under grafana.github.io is deprecated.
  repository = "https://grafana-community.github.io/helm-charts"
  chart      = "grafana"
  version    = "14.3.1"
  depends_on = [
    helm_release.grafana_secret,
    google_project_iam_member.grafana_monitoring_viewer,
    google_compute_router_nat.nat,
  ]

  values = [
    file("values/grafana.yaml"),
    # The one datasource: Cloud Monitoring, which also serves the Managed Prometheus data (PromQL).
    yamlencode({
      datasources = {
        "datasources.yaml" = {
          apiVersion = 1
          datasources = [{
            name      = "Google Cloud Monitoring"
            type      = "stackdriver"
            access    = "proxy"
            isDefault = true
            jsonData = {
              authenticationType = "gce"
              defaultProject     = var.project_id
            }
          }]
        }
      }
    }),
  ]
}
