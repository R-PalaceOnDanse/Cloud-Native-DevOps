resource "google_storage_bucket" "sources" {
  name = "${var.project_id}-fn-sources"
  location = var.region
  uniform_bucket_level_access = true
  public_access_prevention = "enforced"
  force_destroy = true

  lifecycle_rule {
    condition { age = 30 }
    action { type = "Delete" }
  }

  depends_on = [ google_project_service.serverless ]
}

data "archive_file" "discord_proxy" {
    type = "zip"
    source_dir="${path.module}/../../app/functions/discord-proxy"
    output_path = "${path.module}/.build/discord-proxy.zip"
    excludes = ["node_modules", "dist"]
}

resource "google_storage_bucket_object" "discord_proxy" {
    name = "discord-proxy/${data.archive_file.discord-poxy.output_md5}.zip"
    bucket = google_storage_bucket.sources.name
    source = data.archive_file.discord_proxy.output_path
}

resource "google_cloudfunctios2_function" "discord_proxy" {
    runtime = "nodejs22"
    entrypoint= "discordProxy"
    service_account = google_service_account.build.id

    source {
        storage_source {
            bucket = google_storage_bucket.sources.name
            object = google_storage_bucket_object.discord_proxy.name
        }
    }

    service_config {
        service_account_email= google_service_account.discord_proxy.email
        min_instance_count=0
        max_instance_count=var.discord_proxy_max_instance
        available_memory = "256M"
        timeout_seconds = 30
        all_traffic_on_latest_revision = true
    
        ingress_settings = "ALLOW_ALL"

        environment_variables = {
            DISCORD_PUBLIC_KEY_SECRET_VERSION = "${google_secret_manager_secret.discord_public_key.id}/versions/latest"
        }

        depends_on = [
            google_project_service.serverless,
            google_project_iam_member.build,
        ]
    }
}

resource "google_cloud_run_v2_service_iam_member" "gateway_invokes_discord_proxy" {
    project = var.project.id
    location = var.region
    name = google_cloudfunctions2_function.discord_proxy.name
    role ="roles/run.invoker"
    member="serviceAccount:${google_service_account.gateway.email}"
}