/**
 * Application Observability Dashboard (Issue #86)
 *
 * Displays end-to-end metrics for the serverless collaborative canvas pipeline:
 * - Invocations (Requests/sec per function)
 * - Error rate (5xx per function)
 * - Execution latency (p50, p95 ms)
 * - Pub/Sub queue depth (undelivered messages)
 * - Pub/Sub oldest unacked message age (seconds)
 * - Dead-letter queue (DLQ) message count
 */

resource "google_monitoring_dashboard" "serverless_app" {
  project = var.project_id
  dashboard_json = jsonencode({
    displayName = "Canvas Serverless Application Dashboard (${var.project_id})"
    gridLayout = {
      columns = 2
      widgets = [
        {
          title = "Cloud Functions Invocations (Requests / sec)"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"run.googleapis.com/request_count\" resource.type=\"cloud_run_revision\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.label.service_name"]
                    }
                  }
                }
              }
            ]
          }
        },
        {
          title = "Cloud Functions Errors (5xx)"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"run.googleapis.com/request_count\" resource.type=\"cloud_run_revision\" metric.label.response_code_class=\"5xx\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.label.service_name"]
                    }
                  }
                }
              }
            ]
          }
        },
        {
          title = "Cloud Functions Execution Latency (p95 ms)"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"run.googleapis.com/request_latencies\" resource.type=\"cloud_run_revision\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_PERCENTILE_95"
                      crossSeriesReducer = "REDUCE_NONE"
                      groupByFields      = ["resource.label.service_name"]
                    }
                  }
                }
              }
            ]
          }
        },
        {
          title = "Pub/Sub Queue Depth (Unacknowledged Messages)"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"pubsub.googleapis.com/subscription/num_undelivered_messages\" resource.type=\"pubsub_subscription\""
                    aggregation = {
                      alignmentPeriod  = "60s"
                      perSeriesAligner = "ALIGN_MEAN"
                    }
                  }
                }
              }
            ]
          }
        },
        {
          title = "Pub/Sub Oldest Unacked Message Age (seconds)"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"pubsub.googleapis.com/subscription/oldest_unacked_message_age\" resource.type=\"pubsub_subscription\""
                    aggregation = {
                      alignmentPeriod  = "60s"
                      perSeriesAligner = "ALIGN_MAX"
                    }
                  }
                }
              }
            ]
          }
        },
        {
          title = "Dead-Letter Queue (DLQ) Message Activity"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"pubsub.googleapis.com/topic/send_request_count\" resource.type=\"pubsub_topic\" resource.label.topic_id=\"pixel-draw-events-dlq\""
                    aggregation = {
                      alignmentPeriod  = "60s"
                      perSeriesAligner = "ALIGN_RATE"
                    }
                  }
                }
              }
            ]
          }
        }
      ]
    }
  })
}
