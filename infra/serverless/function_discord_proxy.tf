data "archive_file" "discord_proxy" {
  type        = "zip"
  source_dir  = "${path.module}/../../app/functions/discord-proxy"
  output_path = "${path.module}/.build/discord-proxy.zip"
  excludes    = ["node_modules", "dist"]
}

resource "google_storage_bucket_object" "discord_proxy" {
  name   = "discord-proxy/${data.archive_file.discord_proxy.output_md5}.zip"
  bucket = google_storage_bucket.sources.name
  source = data.archive_file.discord_proxy.output_path
}

resource "google_cloudfunctions2_function" "discord_proxy" {
  name        = "discord-proxy"
  location    = var.region
  description = "C06: discord proxy function"

  build_config {
    runtime           = "nodejs22"
    entry_point       = "discordProxy"
    service_account   = google_service_account.build.id
    docker_repository = google_artifact_registry_repository.functions.id

    source {
      storage_source {
        bucket = google_storage_bucket.sources.name
        object = google_storage_bucket_object.discord_proxy.name
      }
    }
  }

  service_config {
    service_account_email          = google_service_account.discord_proxy.email
    min_instance_count             = 0
    max_instance_count             = var.discord_proxy_max_instances
    available_memory               = "256M"
    timeout_seconds                = 30
    all_traffic_on_latest_revision = true

    ingress_settings = "ALLOW_ALL"

    environment_variables = {
      GOOGLE_CLOUD_PROJECT              = var.project_id
      DISCORD_PUBLIC_KEY_SECRET_VERSION = "${google_secret_manager_secret.discord_public_key.id}/versions/latest"
      PIXEL_DRAW_TOPIC                  = google_pubsub_topic.pixel_draw.name
    }
  }

  depends_on = [
    google_project_service.serverless,
    google_project_iam_member.build,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "gateway_invokes_discord_proxy" {
  project  = var.project_id
  location = var.region
  name     = google_cloudfunctions2_function.discord_proxy.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.gateway.email}"
}