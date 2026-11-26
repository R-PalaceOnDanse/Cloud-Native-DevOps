# Discord OAuth2 Login Callback Cloud Function (Issue #79 / C07 §3.1)

data "archive_file" "auth_callback" {
  type        = "zip"
  source_dir  = "${path.module}/../../app/functions/auth-callback"
  output_path = "${path.module}/.build/auth-callback.zip"
  excludes    = ["node_modules", "dist"]
}

resource "google_storage_bucket_object" "auth_callback" {
  name   = "auth-callback/${data.archive_file.auth_callback.output_md5}.zip"
  bucket = google_storage_bucket.sources.name
  source = data.archive_file.auth_callback.output_path
}

resource "google_cloudfunctions2_function" "auth_callback" {
  name        = "auth-callback"
  location    = var.region
  description = "Exchanges Discord OAuth2 authorization code and mints session token."

  build_config {
    runtime           = "nodejs22"
    entry_point       = "authCallback"
    service_account   = google_service_account.build.id
    docker_repository = google_artifact_registry_repository.functions.id

    source {
      storage_source {
        bucket = google_storage_bucket.sources.name
        object = google_storage_bucket_object.auth_callback.name
      }
    }
  }

  service_config {
    service_account_email          = google_service_account.auth_callback.email
    min_instance_count             = 0
    max_instance_count             = 5
    available_memory               = "256M"
    timeout_seconds                = 15
    all_traffic_on_latest_revision = true
    # Same as web-draw-proxy: reachable only through the gateway service account.
    ingress_settings = "ALLOW_ALL"

    # The client secret never appears in Terraform: the function reads it from Secret Manager at
    # request time, so a deployment does not fail before someone has added its value.
    environment_variables = {
      GOOGLE_CLOUD_PROJECT          = var.project_id
      DISCORD_CLIENT_ID             = var.discord_client_id
      DISCORD_REDIRECT_URI          = local.frontend_origin # must be registered as an OAuth2 redirect on Discord
      FRONTEND_ORIGIN               = local.frontend_origin
      DISCORD_CLIENT_SECRET_VERSION = "${google_secret_manager_secret.discord_client_secret.id}/versions/latest"
    }
  }

  depends_on = [
    google_project_service.serverless,
    google_project_iam_member.build,
    google_secret_manager_secret_iam_member.auth_callback_reads_client_secret,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "gateway_invokes_auth_callback" {
  project  = var.project_id
  location = var.region
  name     = google_cloudfunctions2_function.auth_callback.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.gateway.email}"
}
