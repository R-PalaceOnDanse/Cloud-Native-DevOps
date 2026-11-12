locals {
  principal_prefix = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}"

  required_apis = [
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
  ]

  # Reads everything and the IAM policies, so that terraform plan can refresh the state.
  plan_project_roles = [
    "roles/viewer",
    "roles/iam.securityReviewer",
    "roles/serviceusage.serviceUsageConsumer",
    # The serverless stack has an API key: refreshing it reads its value.
    "roles/serviceusage.apiKeysViewer",
  ]

  # Creates and changes resources and their IAM bindings. Broad on purpose for now: it is narrowed
  # when the stacks that need specific roles exist (see docs/infra.md).
  apply_project_roles = [
    "roles/editor",
    "roles/resourcemanager.projectIamAdmin",
    # Editor cannot set IAM policies on resources. The serverless stack sets them on a Cloud Run
    # service (who may invoke a function) and on a secret (which function may read it).
    "roles/run.admin",
    "roles/secretmanager.admin",
  ]
}

resource "google_project_service" "required" {
  for_each = toset(local.required_apis)

  service            = each.value
  disable_on_destroy = false
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  description               = "Short-lived credentials for the pipelines of ${var.github_repository}."

  depends_on = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions OIDC"

  attribute_mapping = {
    "google.subject"        = "assertion.sub"
    "attribute.repository"  = "assertion.repository"
    "attribute.environment" = "assertion.environment"
  }

  # Tokens issued for any other repository are refused before any service account is considered.
  attribute_condition = "assertion.repository == \"${var.github_repository}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "plan" {
  account_id   = "github-plan"
  display_name = "GitHub Actions: terraform plan"
  description  = "Read-only identity for plans. Any workflow of the repository may use it."

  depends_on = [google_project_service.required]
}

resource "google_service_account" "apply" {
  account_id   = "github-apply"
  display_name = "GitHub Actions: terraform apply and destroy"
  description  = "Identity that changes resources. Only jobs of the ${var.environment} GitHub environment may use it."

  depends_on = [google_project_service.required]
}

resource "google_project_iam_member" "plan" {
  for_each = toset(local.plan_project_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.plan.email}"
}

resource "google_project_iam_member" "apply" {
  for_each = toset(local.apply_project_roles)

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.apply.email}"
}

# Terraform writes a lock object even for a plan, so both identities need to write in the state bucket.
resource "google_storage_bucket_iam_member" "plan_state" {
  bucket = var.state_bucket
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.plan.email}"
}

resource "google_storage_bucket_iam_member" "apply_state" {
  bucket = var.state_bucket
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.apply.email}"
}

resource "google_service_account_iam_member" "plan_from_repository" {
  service_account_id = google_service_account.plan.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "${local.principal_prefix}/attribute.repository/${var.github_repository}"
}

resource "google_service_account_iam_member" "apply_from_environment" {
  service_account_id = google_service_account.apply.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "${local.principal_prefix}/attribute.environment/${var.environment}"
}
