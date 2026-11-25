locals {
  # Created by the access stack (infra/access/runner_secret.tf); the values are added by hand.
  runner_secret_names = [
    "arc-github-token",
    "arc-github-app-id",
    "arc-github-app-installation-id",
    "arc-github-app-private-key",
  ]
  eso_namespace       = "external-secrets"
  eso_service_account = "external-secrets"
}

data "google_project" "this" {
  project_id = var.project_id
}

# External Secrets Operator copies Secret Manager secrets into Kubernetes secrets (ADR-0016).
resource "helm_release" "external_secrets" {
  name             = "external-secrets"
  namespace        = local.eso_namespace
  create_namespace = true
  repository       = "https://charts.external-secrets.io"
  chart            = "external-secrets"
  version          = "2.13.0"
  depends_on       = [google_container_node_pool.system]

  values = [
    file("values/external-secrets.yaml")
  ]

  set {
    name  = "serviceAccount.name"
    value = local.eso_service_account
  }
}

# The operator reads the secrets as its own Kubernetes service account, through Workload Identity:
# no Google account and no key. Only these runner secrets are readable.
resource "google_secret_manager_secret_iam_member" "eso_reads_runner_secrets" {
  for_each  = toset(local.runner_secret_names)
  secret_id = "projects/${var.project_id}/secrets/${each.value}"
  role      = "roles/secretmanager.secretAccessor"
  member    = "principal://iam.googleapis.com/projects/${data.google_project.this.number}/locations/global/workloadIdentityPools/${var.project_id}.svc.id.goog/subject/ns/${local.eso_namespace}/sa/${local.eso_service_account}"

  depends_on = [google_project_service.secretmanager]
}

# The store and the secret to copy, as a small local chart: the operator's custom resources do not
# exist yet when Terraform plans, so they cannot be declared as kubernetes_manifest.
resource "helm_release" "arc_secret" {
  name             = "arc-secret"
  namespace        = "arc-runners"
  create_namespace = true
  chart            = "${path.module}/charts/arc-secret"
  depends_on       = [helm_release.external_secrets]

  set {
    name  = "projectId"
    value = var.project_id
  }

  set {
    name  = "authType"
    value = var.runner_auth_type
  }

  set {
    name  = "secretName"
    value = "arc-github-token"
  }

  set {
    name  = "appIdSecretName"
    value = "arc-github-app-id"
  }

  set {
    name  = "appInstallationIdSecretName"
    value = "arc-github-app-installation-id"
  }

  set {
    name  = "appPrivateKeySecretName"
    value = "arc-github-app-private-key"
  }
}
