/**
 * Serverless Alert Policies & Notification Channels (Issue #87)
 *
 * Implements real-time alerting for critical application problems:
 * 1. High Cloud Functions 5xx Error Rate (>5% over 60s)
 * 2. Pub/Sub Dead-Letter Queue (DLQ) Active Messages (>0)
 * 3. Pub/Sub Message Backlog Age (>60s oldest unacknowledged message)
 */

resource "google_monitoring_notification_channel" "email_team" {
  project      = var.project_id
  display_name = "Team Alert Email (${var.project_id})"
  type         = "email"
  labels = {
    email_address = "quaduval@gmail.com"
  }
}

resource "google_monitoring_alert_policy" "cloud_functions_error_rate" {
  project      = var.project_id
  display_name = "Cloud Functions High Error Rate (>5% 5xx)"
  combiner     = "OR"

  conditions {
    display_name = "5xx HTTP Error Rate on Serverless Functions"
    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/request_count\" resource.type=\"cloud_run_revision\" metric.label.response_code_class=\"5xx\""
      duration        = "60s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0.05

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.service_name"]
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email_team.name]

  documentation {
    content   = "A Cloud Function error rate exceeded 5% over 60s. Inspect logs filtered by `severity>=ERROR` or correlation ID in Cloud Logging."
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "pubsub_dlq_messages" {
  project      = var.project_id
  display_name = "Pub/Sub Dead-Letter Queue Active Messages"
  combiner     = "OR"

  conditions {
    display_name = "Unacknowledged messages on Dead-Letter Subscription"
    condition_threshold {
      filter          = "metric.type=\"pubsub.googleapis.com/topic/send_request_count\" resource.type=\"pubsub_topic\" resource.label.topic_id=\"pixel-draw-events-dlq\""
      duration        = "0s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email_team.name]

  documentation {
    content   = "One or more poison pill messages were routed to the Dead-Letter Queue `pixel-draw-events-dlq` after exhausting delivery retries."
    mime_type = "text/markdown"
  }
}

resource "google_monitoring_alert_policy" "pubsub_message_age" {
  project      = var.project_id
  display_name = "Pub/Sub Draw Queue Backlog (Age > 60s)"
  combiner     = "OR"

  conditions {
    display_name = "Oldest unacknowledged message age > 60s"
    condition_threshold {
      filter          = "metric.type=\"pubsub.googleapis.com/subscription/oldest_unacked_message_age\" resource.type=\"pubsub_subscription\" resource.label.subscription_id=\"draw-worker-sub\""
      duration        = "60s"
      comparison      = "COMPARISON_GT"
      threshold_value = 60

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MAX"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email_team.name]

  documentation {
    content   = "The draw worker subscription `draw-worker-sub` has messages older than 60 seconds, indicating worker backpressure or worker scaling limits."
    mime_type = "text/markdown"
  }
}
