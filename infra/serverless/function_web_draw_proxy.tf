# Web Draw Proxy Cloud Function (Issue #76 / C07 §3.2)

data "archive_file" "web_draw_proxy" {
  type        = "zip"
  source_dir  = "${path.module}/../../app/functions/web-draw-proxy"
  output_path = "${path.module}/.build/web-draw-proxy.zip"
  excludes    = ["node_modules", "dist"]
}

resource "google_storage_bucket_object" "web_draw_proxy" {
  name   = "web-draw-proxy/${data.archive_file.web_draw_proxy.output_md5}.zip"
  bucket = google_storage_bucket.sources.name
  source = data.archive_file.web_draw_proxy.output_path
}

resource "google_cloudfunctions2_function" "web_draw_proxy" {
  name        = "web-draw-proxy"
  location    = var.region
  description = "Receives web client brush strokes and publishes to Pub/Sub."

  build_config {
    runtime         = "nodejs22"
    entry_point     = "webDrawProxy"
    service_account = google_service_account.build.id

    source {
      storage_source {
        bucket = google_storage_bucket.sources.name
        object = google_storage_bucket_object.web_draw_proxy.name
      }
    }
  }

  service_config {
    service_account_email          = google_service_account.web_draw_proxy.email
    min_instance_count             = 0
    max_instance_count             = 5
    available_memory               = "256M"
    timeout_seconds                = 15
    all_traffic_on_latest_revision = true
    # API Gateway does not run in the VPC: the function stays reachable, but only the gateway service
    # account may invoke it (no allUsers binding).
    ingress_settings = "ALLOW_ALL"

    environment_variables = {
      GOOGLE_CLOUD_PROJECT = var.project_id
      PIXEL_DRAW_TOPIC     = google_pubsub_topic.pixel_draw.name
      FRONTEND_ORIGIN      = local.frontend_origin
    }
  }

  depends_on = [
    google_project_service.serverless,
    google_project_iam_member.build,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "gateway_invokes_web_draw_proxy" {
  project  = var.project_id
  location = var.region
  name     = google_cloudfunctions2_function.web_draw_proxy.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.gateway.email}"
}
