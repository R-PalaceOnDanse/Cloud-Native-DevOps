# Message Broker Pub/Sub Topics & Dead-Letter Queues (Issue #137 / C06 §3 & ADR-0006)

resource "google_pubsub_topic" "pixel_draw" {
  name                       = "pixel-draw-events"
  message_retention_duration = "604800s" # 7 days
}

resource "google_pubsub_topic" "pixel_draw_dlq" {
  name                       = "pixel-draw-events-dlq"
  message_retention_duration = "604800s" # 7 days
}

resource "google_pubsub_subscription" "draw_worker" {
  name  = "draw-worker-sub"
  topic = google_pubsub_topic.pixel_draw.name

  ack_deadline_seconds = 60

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.pixel_draw_dlq.id
    max_delivery_attempts = 5
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }
}
