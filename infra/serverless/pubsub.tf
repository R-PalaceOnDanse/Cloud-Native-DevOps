# Message broker (C06 §3, ADR-0006). Proxies publish to pixel-draw-events; Pub/Sub pushes each message
# to the worker, authenticated with an OIDC token of a dedicated service account. After 5 failed
# deliveries a message goes to the dead-letter topic, where it is kept for inspection (DLQ alert in
# alerts.tf).

resource "google_pubsub_topic" "pixel_draw" {
  name                       = "pixel-draw-events"
  message_retention_duration = "604800s" # 7 days, to replay or debug

  depends_on = [google_project_service.serverless]
}

resource "google_pubsub_topic" "pixel_draw_dlq" {
  name                       = "pixel-draw-events-dlq"
  message_retention_duration = "604800s"

  depends_on = [google_project_service.serverless]
}

# Identity Pub/Sub uses to call the push endpoints. It can only invoke draw-worker and snapshot-notifier.
resource "google_service_account" "pubsub_push" {
  account_id   = "pubsub-push"
  display_name = "Pub/Sub push to the workers"
  description  = "Signs the OIDC token of the push subscriptions. Only invokes draw-worker and snapshot-notifier."
}

resource "google_cloud_run_v2_service_iam_member" "pubsub_invokes_worker" {
  project  = var.project_id
  location = var.region
  name     = google_cloudfunctions2_function.draw_worker.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.pubsub_push.email}"
}

# Google-managed Pub/Sub service agent: mints the push token, forwards to the dead-letter topic.
resource "google_project_service_identity" "pubsub" {
  provider = google-beta
  project  = var.project_id
  service  = "pubsub.googleapis.com"
}

resource "google_service_account_iam_member" "pubsub_agent_mints_push_token" {
  service_account_id = google_service_account.pubsub_push.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_project_service_identity.pubsub.email}"
}

resource "google_pubsub_subscription" "draw_worker" {
  name  = "draw-worker-sub"
  topic = google_pubsub_topic.pixel_draw.id

  ack_deadline_seconds       = 60 # the worker timeout
  message_retention_duration = "604800s"

  push_config {
    push_endpoint = google_cloudfunctions2_function.draw_worker.service_config[0].uri

    oidc_token {
      service_account_email = google_service_account.pubsub_push.email
      audience              = google_cloudfunctions2_function.draw_worker.service_config[0].uri
    }
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.pixel_draw_dlq.id
    max_delivery_attempts = 5
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  depends_on = [
    google_cloud_run_v2_service_iam_member.pubsub_invokes_worker,
    google_service_account_iam_member.pubsub_agent_mints_push_token,
  ]
}

# Without these two grants the dead-letter policy silently does nothing.
resource "google_pubsub_topic_iam_member" "pubsub_agent_publishes_dlq" {
  topic  = google_pubsub_topic.pixel_draw_dlq.id
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_project_service_identity.pubsub.email}"
}

resource "google_pubsub_subscription_iam_member" "pubsub_agent_acks_source" {
  subscription = google_pubsub_subscription.draw_worker.id
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:${google_project_service_identity.pubsub.email}"
}

# A topic without subscription drops its messages: this one keeps the dead letters 7 days.
resource "google_pubsub_subscription" "dlq_inspection" {
  name                       = "pixel-draw-events-dlq-inspection"
  topic                      = google_pubsub_topic.pixel_draw_dlq.id
  message_retention_duration = "604800s"
  ack_deadline_seconds       = 60
  expiration_policy {
    ttl = "" # never expires
  }
}

# --- Snapshot notification (#169, C07 §2) ---
# The bucket publishes OBJECT_FINALIZE of snapshots/* to snapshot-ready, which pushes to
# snapshot-notifier: the worker never calls the notifier.

resource "google_pubsub_topic" "snapshot_ready" {
  name                       = "snapshot-ready"
  message_retention_duration = "86400s" # an interaction token lives 15 minutes: 1 day is plenty

  depends_on = [google_project_service.serverless]
}

resource "google_pubsub_topic" "snapshot_ready_dlq" {
  name                       = "snapshot-ready-dlq"
  message_retention_duration = "604800s"

  depends_on = [google_project_service.serverless]
}

# Google-managed Cloud Storage service agent: the only publisher of snapshot-ready.
data "google_storage_project_service_account" "gcs" {}

resource "google_pubsub_topic_iam_member" "gcs_publishes_snapshot_ready" {
  topic  = google_pubsub_topic.snapshot_ready.id
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${data.google_storage_project_service_account.gcs.email_address}"
}

resource "google_storage_notification" "snapshot_ready" {
  bucket             = google_storage_bucket.snapshots.name
  topic              = google_pubsub_topic.snapshot_ready.id
  payload_format     = "JSON_API_V1" # the object resource, custom metadata included
  event_types        = ["OBJECT_FINALIZE"]
  object_name_prefix = "snapshots/"

  depends_on = [google_pubsub_topic_iam_member.gcs_publishes_snapshot_ready]
}

resource "google_cloud_run_v2_service_iam_member" "pubsub_invokes_snapshot_notifier" {
  project  = var.project_id
  location = var.region
  name     = google_cloudfunctions2_function.snapshot_notifier.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.pubsub_push.email}"
}

resource "google_pubsub_subscription" "snapshot_notifier" {
  name  = "snapshot-notifier-sub"
  topic = google_pubsub_topic.snapshot_ready.id

  ack_deadline_seconds       = 30 # the notifier timeout
  message_retention_duration = "86400s"

  push_config {
    push_endpoint = google_cloudfunctions2_function.snapshot_notifier.service_config[0].uri

    oidc_token {
      service_account_email = google_service_account.pubsub_push.email
      audience              = google_cloudfunctions2_function.snapshot_notifier.service_config[0].uri
    }
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.snapshot_ready_dlq.id
    max_delivery_attempts = 5
  }

  # Short backoff: the link is useless once the 15 minute interaction token has expired.
  retry_policy {
    minimum_backoff = "5s"
    maximum_backoff = "60s"
  }

  depends_on = [
    google_cloud_run_v2_service_iam_member.pubsub_invokes_snapshot_notifier,
    google_service_account_iam_member.pubsub_agent_mints_push_token,
  ]
}

resource "google_pubsub_topic_iam_member" "pubsub_agent_publishes_snapshot_dlq" {
  topic  = google_pubsub_topic.snapshot_ready_dlq.id
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_project_service_identity.pubsub.email}"
}

resource "google_pubsub_subscription_iam_member" "pubsub_agent_acks_snapshot_source" {
  subscription = google_pubsub_subscription.snapshot_notifier.id
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:${google_project_service_identity.pubsub.email}"
}

resource "google_pubsub_subscription" "snapshot_dlq_inspection" {
  name                       = "snapshot-ready-dlq-inspection"
  topic                      = google_pubsub_topic.snapshot_ready_dlq.id
  message_retention_duration = "604800s"
  ack_deadline_seconds       = 60
  expiration_policy {
    ttl = "" # never expires
  }
}

# Only the proxies may publish, and only to this topic (least privilege, C05 §6).
resource "google_pubsub_topic_iam_member" "web_draw_proxy_publishes" {
  topic  = google_pubsub_topic.pixel_draw.id
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_service_account.web_draw_proxy.email}"
}

resource "google_pubsub_topic_iam_member" "discord_proxy_publishes" {
  topic  = google_pubsub_topic.pixel_draw.id
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${google_service_account.discord_proxy.email}"
}
