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

# Runtime identity of the draw worker function (Issue #136).
resource "google_service_account" "draw_worker" {
  account_id   = "fn-draw-worker"
  display_name = "Function draw-worker: runtime"
  description  = "Consumes Pub/Sub events, updates Firestore chunks, and writes snapshots."
}

resource "google_project_iam_member" "draw_worker" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/datastore.user",
    "roles/pubsub.subscriber",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.draw_worker.email}"
}

resource "google_storage_bucket_iam_member" "draw_worker_snapshots" {
  bucket = google_storage_bucket.snapshots.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.draw_worker.email}"
}

# Runtime identity of the web draw proxy function.
resource "google_service_account" "web_draw_proxy" {
  account_id   = "fn-web-draw-proxy"
  display_name = "Function web-draw-proxy: runtime"
  description  = "Receives web draw requests and publishes to Pub/Sub."
}

resource "google_project_iam_member" "web_draw_proxy" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/pubsub.publisher",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.web_draw_proxy.email}"
}

# Runtime identity of the Discord auth callback function.
resource "google_service_account" "auth_callback" {
  account_id   = "fn-auth-callback"
  display_name = "Function auth-callback: runtime"
  description  = "Handles Discord OAuth2 code exchange and mints session tokens."
}

resource "google_project_iam_member" "auth_callback" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/secretmanager.secretAccessor",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.auth_callback.email}"
}
