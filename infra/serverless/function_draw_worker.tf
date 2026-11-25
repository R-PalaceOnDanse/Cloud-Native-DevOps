# Draw Worker Cloud Function (Issue #141 / C06.4 & ADR-0006)

data "archive_file" "draw_worker" {
  type        = "zip"
  source_dir  = "${path.module}/../../app/functions/draw-worker"
  output_path = "${path.module}/.build/draw-worker.zip"
  excludes    = ["node_modules", "dist"]
}

resource "google_storage_bucket_object" "draw_worker" {
  name   = "draw-worker/${data.archive_file.draw_worker.output_md5}.zip"
  bucket = google_storage_bucket.sources.name
  source = data.archive_file.draw_worker.output_path
}

resource "google_cloudfunctions2_function" "draw_worker" {
  name        = "draw-worker"
  location    = var.region
  description = "Asynchronous draw and command worker consuming Pub/Sub events."

  build_config {
    runtime         = "nodejs22"
    entry_point     = "drawWorker"
    service_account = google_service_account.build.id

    source {
      storage_source {
        bucket = google_storage_bucket.sources.name
        object = google_storage_bucket_object.draw_worker.name
      }
    }
  }

  service_config {
    service_account_email          = google_service_account.draw_worker.email
    min_instance_count             = 0
    max_instance_count             = var.worker_max_instances
    available_memory               = "512M"
    timeout_seconds                = 60
    all_traffic_on_latest_revision = true
    # Only reachable from Google services of the project (the Pub/Sub push), never from the internet.
    ingress_settings = "ALLOW_INTERNAL_ONLY"

    environment_variables = {
      SNAPSHOT_BUCKET = google_storage_bucket.snapshots.name
      ADMIN_USER_IDS  = join(",", var.admin_user_ids)
      ADMIN_ROLE_ID   = var.admin_role_id
    }
  }

  depends_on = [
    google_project_service.serverless,
    google_project_iam_member.build,
  ]
}
