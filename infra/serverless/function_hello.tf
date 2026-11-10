# Private bucket holding the zipped function sources.
resource "google_storage_bucket" "sources" {
  name                        = "${var.project_id}-fn-sources"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = true # the stack must be disposable

  lifecycle_rule {
    condition { age = 30 }
    action { type = "Delete" }
  }

  depends_on = [google_project_service.serverless]
}

data "archive_file" "hello" {
  type        = "zip"
  source_dir  = "${path.module}/../../app/functions/hello"
  output_path = "${path.module}/.build/hello.zip"
  excludes    = ["node_modules", "dist"]
}

# The object name carries the hash of the source, so a code change creates a new object and
# redeploys the function; an unchanged source changes nothing.
resource "google_storage_bucket_object" "hello" {
  name   = "hello/${data.archive_file.hello.output_md5}.zip"
  bucket = google_storage_bucket.sources.name
  source = data.archive_file.hello.output_path
}

resource "google_cloudfunctions2_function" "hello" {
  name        = "hello"
  location    = var.region
  description = "C05: first function, reachable only through API Gateway."

  build_config {
    runtime         = "nodejs22"
    entry_point     = "hello"
    service_account = google_service_account.build.id

    source {
      storage_source {
        bucket = google_storage_bucket.sources.name
        object = google_storage_bucket_object.hello.name
      }
    }
  }

  service_config {
    service_account_email          = google_service_account.hello.email
    min_instance_count             = 0
    max_instance_count             = var.hello_max_instances
    available_memory               = "256M"
    timeout_seconds                = 30
    all_traffic_on_latest_revision = true

    # API Gateway does not run in the VPC, so internal-only ingress would block it. The function is
    # protected by IAM instead: only the gateway's service account has run.invoker (below).
    ingress_settings = "ALLOW_ALL"

    environment_variables = {
      HELLO_SECRET_VERSION = "${google_secret_manager_secret.hello_greeting.id}/versions/latest"
    }
  }

  depends_on = [
    google_project_service.serverless,
    google_project_iam_member.build,
  ]
}

# A Cloud Run function is a Cloud Run service with the same name: invocation is controlled there.
resource "google_cloud_run_v2_service_iam_member" "gateway_invokes_hello" {
  project  = var.project_id
  location = var.region
  name     = google_cloudfunctions2_function.hello.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.gateway.email}"
}
