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
  for_each = toset([
    "roles/logging.logWriter",
    "roles/cloudtrace.agent",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.hello.email}"
}

# Runtime identiy of the discord-proxy function
resource "google_service_account" "discord_proxy" {
  account_id   = "fn-discord-proxy"
  display_name = "Function discord-proxy: runtime"
  description  = "Runs the discord proxy function"
}

resource "google_project_iam_member" "discord_proxy_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.discord_proxy.email}"

}

# Writes its span of each command to Cloud Trace (#88).
resource "google_project_iam_member" "discord_proxy_traces" {
  project = var.project_id
  role    = "roles/cloudtrace.agent"
  member  = "serviceAccount:${google_service_account.discord_proxy.email}"
}

# Identity the gateway uses to call the functions. It is the only principal allowed to invoke them.
resource "google_service_account" "gateway" {
  account_id   = "api-gateway"
  display_name = "API Gateway: backend caller"
  description  = "Used by API Gateway to invoke the proxy functions."
}

# Google-managed API Gateway Service Agent (Issue #132).
# Required to generate OIDC ID tokens when invoking backend Cloud Run services.
resource "google_project_service_identity" "apigateway" {
  provider = google-beta
  project  = var.project_id
  service  = "apigateway.googleapis.com"
}

# Grants the API Gateway Service Agent permission to impersonate the gateway service account
# and mint JWT ID tokens for private backend functions (Issue #132).
resource "google_service_account_iam_member" "gateway_token_creator" {
  service_account_id = google_service_account.gateway.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_project_service_identity.apigateway.email}"
}

# Runtime identity of the draw worker function (Issue #136).
resource "google_service_account" "draw_worker" {
  account_id   = "fn-draw-worker"
  display_name = "Function draw-worker: runtime"
  description  = "Consumes Pub/Sub events, updates Firestore chunks, and writes snapshots."
}

# Pub/Sub pushes to it (pubsub.tf), so it needs no subscriber role.
resource "google_project_iam_member" "draw_worker" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/datastore.user", # chunks, config/system, ratelimits
    "roles/cloudtrace.agent",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.draw_worker.email}"
}

# Creates the snapshots, nothing else: it can neither read, list, overwrite nor sign them. The link
# is the job of snapshot-notifier (#169).
resource "google_storage_bucket_iam_member" "draw_worker_snapshots" {
  bucket = google_storage_bucket.snapshots.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.draw_worker.email}"
}

# Runtime identity of the snapshot notifier function (#169).
resource "google_service_account" "snapshot_notifier" {
  account_id   = "fn-snapshot-notifier"
  display_name = "Function snapshot-notifier: runtime"
  description  = "Signs a read URL for each new snapshot and edits the Discord answer."
}

# Pub/Sub pushes to it (pubsub.tf), so it needs no subscriber role.
resource "google_project_iam_member" "snapshot_notifier" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/cloudtrace.agent",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.snapshot_notifier.email}"
}

# A signed URL grants what its signer may do: reading the snapshots, nothing else.
resource "google_storage_bucket_iam_member" "snapshot_notifier_reads_snapshots" {
  bucket = google_storage_bucket.snapshots.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.snapshot_notifier.email}"
}

# Signs the snapshot URLs with its own identity (IAM signBlob): no key file exists.
resource "google_service_account_iam_member" "snapshot_notifier_signs_urls" {
  service_account_id = google_service_account.snapshot_notifier.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.snapshot_notifier.email}"
}

# Runtime identity of the web draw proxy function.
resource "google_service_account" "web_draw_proxy" {
  account_id   = "fn-web-draw-proxy"
  display_name = "Function web-draw-proxy: runtime"
  description  = "Receives web draw requests and publishes to Pub/Sub."
}

# Publishes to pixel-draw-events only: the grant is on the topic (pubsub.tf), not on the project.
resource "google_project_iam_member" "web_draw_proxy" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/cloudtrace.agent",
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

# Reads one secret (granted on the secret, secrets.tf) and mints Firebase custom tokens.
resource "google_project_iam_member" "auth_callback" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/cloudtrace.agent",
  ])

  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.auth_callback.email}"
}

# firebase-admin signs the custom tokens through IAM signBlob with this identity: no key file.
resource "google_service_account_iam_member" "auth_callback_signs_tokens" {
  service_account_id = google_service_account.auth_callback.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.auth_callback.email}"
}
