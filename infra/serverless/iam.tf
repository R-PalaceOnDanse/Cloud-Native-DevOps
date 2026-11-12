# One identity per component (least privilege, C05 §2.3). None of them uses the default compute
# service account, which has Editor on the project.

# Builds the function sources. Without it, Cloud Build would use the default compute account.
resource "google_service_account" "build" {
  account_id   = "fn-build"
  display_name = "Cloud Run functions: build"
  description  = "Builds the function sources with Cloud Build."
}

resource "google_project_iam_member" "build" {
  for_each = toset([
    "roles/logging.logWriter",       # build logs
    "roles/artifactregistry.writer", # push the built image
    "roles/storage.objectViewer",    # read the uploaded source
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.build.email}"
}

# Runtime identity of the hello function.
resource "google_service_account" "hello" {
  account_id   = "fn-hello"
  display_name = "Function hello: runtime"
  description  = "Runs the hello function. Writes logs and reads one secret, nothing else."
}

resource "google_project_iam_member" "hello_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.hello.email}"
}

# Identity the gateway uses to call the functions. It is the only principal allowed to invoke them.
resource "google_service_account" "gateway" {
  account_id   = "api-gateway"
  display_name = "API Gateway: backend caller"
  description  = "Used by API Gateway to invoke the proxy functions."
}
