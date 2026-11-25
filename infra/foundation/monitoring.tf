# Cloud Monitoring Dashboard and Alerts for the GKE cluster and runners (ADR-0010, ADR-0021)

# One email channel per team member: every alert below reaches all of them.
resource "google_monitoring_notification_channel" "email" {
  for_each     = toset(var.alert_emails)
  project      = var.project_id
  display_name = "Alert email ${each.value}"
  type         = "email"

  labels = {
    email_address = each.value
  }

  depends_on = [google_project_service.monitoring]
}

resource "google_monitoring_dashboard" "cluster" {
  project = var.project_id
  dashboard_json = jsonencode({
    displayName = "${var.vpc_name}-gke-overview"
    gridLayout = {
      columns = "2"
      widgets = [
        {
          title = "Node Count by Node Pool"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"k8s_node\" AND resource.label.\"cluster_name\"=\"${var.vpc_name}-gke\" AND metric.type=\"kubernetes.io/node/cpu/total_cores\""
                    aggregation = {
                      perSeriesAligner   = "ALIGN_MEAN"
                      alignmentPeriod    = "60s"
                      crossSeriesReducer = "REDUCE_COUNT"
                      groupByFields      = ["metadata.system_labels.\"node_pool\""]
                    }
                  }
                }
                plotType           = "LINE"
                minAlignmentPeriod = "60s"
              }
            ]
          }
        },
        {
          title = "Node CPU Allocatable Utilization"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"k8s_node\" AND resource.label.\"cluster_name\"=\"${var.vpc_name}-gke\" AND metric.type=\"kubernetes.io/node/cpu/allocatable_utilization\""
                    aggregation = {
                      perSeriesAligner   = "ALIGN_MEAN"
                      alignmentPeriod    = "60s"
                      crossSeriesReducer = "REDUCE_MEAN"
                      groupByFields      = ["resource.label.\"node_name\""]
                    }
                  }
                }
                plotType           = "LINE"
                minAlignmentPeriod = "60s"
              }
            ]
          }
        },
        {
          title = "Node Memory Allocatable Utilization"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"k8s_node\" AND resource.label.\"cluster_name\"=\"${var.vpc_name}-gke\" AND metric.type=\"kubernetes.io/node/memory/allocatable_utilization\""
                    aggregation = {
                      perSeriesAligner   = "ALIGN_MEAN"
                      alignmentPeriod    = "60s"
                      crossSeriesReducer = "REDUCE_MEAN"
                      groupByFields      = ["resource.label.\"node_name\""]
                    }
                  }
                }
                plotType           = "LINE"
                minAlignmentPeriod = "60s"
              }
            ]
          }
        },
        {
          title = "Container CPU Core Usage by Namespace"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"k8s_container\" AND resource.label.\"cluster_name\"=\"${var.vpc_name}-gke\" AND metric.type=\"kubernetes.io/container/cpu/core_usage_time\""
                    aggregation = {
                      perSeriesAligner   = "ALIGN_RATE"
                      alignmentPeriod    = "60s"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.label.\"namespace_name\""]
                    }
                  }
                }
                plotType           = "STACKED_AREA"
                minAlignmentPeriod = "60s"
              }
            ]
          }
        },
        {
          title = "Container Memory Working Set by Namespace"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"k8s_container\" AND resource.label.\"cluster_name\"=\"${var.vpc_name}-gke\" AND metric.type=\"kubernetes.io/container/memory/used_bytes\""
                    aggregation = {
                      perSeriesAligner   = "ALIGN_MEAN"
                      alignmentPeriod    = "60s"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.label.\"namespace_name\""]
                    }
                  }
                }
                plotType           = "STACKED_AREA"
                minAlignmentPeriod = "60s"
              }
            ]
          }
        },
        {
          title = "Container Restarts (by Pod)"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"k8s_container\" AND resource.label.\"cluster_name\"=\"${var.vpc_name}-gke\" AND metric.type=\"kubernetes.io/container/restart_count\""
                    aggregation = {
                      perSeriesAligner   = "ALIGN_RATE"
                      alignmentPeriod    = "60s"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.label.\"pod_name\""]
                    }
                  }
                }
                plotType           = "BAR"
                minAlignmentPeriod = "60s"
              }
            ]
          }
        }
      ]
    }
  })

  depends_on = [
    google_project_service.monitoring,
    google_container_cluster.primary,
  ]
}

# Alert 1: Node High CPU Utilization (> 85% for 5 minutes)
resource "google_monitoring_alert_policy" "node_cpu_high" {
  project      = var.project_id
  display_name = "${var.vpc_name}-gke-node-cpu-high"
  combiner     = "OR"

  notification_channels = [for channel in google_monitoring_notification_channel.email : channel.id]

  conditions {
    display_name = "Node CPU allocatable utilization > 85%"

    condition_threshold {
      filter          = "resource.type=\"k8s_node\" AND resource.label.\"cluster_name\"=\"${var.vpc_name}-gke\" AND metric.type=\"kubernetes.io/node/cpu/allocatable_utilization\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.85
      duration        = "300s"

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MEAN"
        cross_series_reducer = "REDUCE_MEAN"
        group_by_fields      = ["resource.label.\"node_name\""]
      }

      trigger {
        count = 1
      }
    }
  }

  documentation {
    content   = "A GKE cluster node has sustained CPU utilization above 85% for 5 minutes. Inspect running pods in arc-runners and arc-systems."
    mime_type = "text/markdown"
  }

  depends_on = [
    google_project_service.monitoring,
    google_container_cluster.primary,
  ]
}

# Alert 2: Node High Memory Utilization (> 85% for 5 minutes)
resource "google_monitoring_alert_policy" "node_memory_high" {
  project      = var.project_id
  display_name = "${var.vpc_name}-gke-node-memory-high"
  combiner     = "OR"

  notification_channels = [for channel in google_monitoring_notification_channel.email : channel.id]

  conditions {
    display_name = "Node memory allocatable utilization > 85%"

    condition_threshold {
      filter          = "resource.type=\"k8s_node\" AND resource.label.\"cluster_name\"=\"${var.vpc_name}-gke\" AND metric.type=\"kubernetes.io/node/memory/allocatable_utilization\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.85
      duration        = "300s"

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MEAN"
        cross_series_reducer = "REDUCE_MEAN"
        group_by_fields      = ["resource.label.\"node_name\""]
      }

      trigger {
        count = 1
      }
    }
  }

  documentation {
    content   = "A GKE cluster node has sustained memory utilization above 85% for 5 minutes. Check pod memory limits and potential leaks."
    mime_type = "text/markdown"
  }

  depends_on = [
    google_project_service.monitoring,
    google_container_cluster.primary,
  ]
}

# Alert 3: Container Restart Storm (detect CrashLoopBackOff or failing pods)
resource "google_monitoring_alert_policy" "container_restarts" {
  project      = var.project_id
  display_name = "${var.vpc_name}-gke-container-restarts"
  combiner     = "OR"

  notification_channels = [for channel in google_monitoring_notification_channel.email : channel.id]

  conditions {
    display_name = "Container restart rate elevated"

    condition_threshold {
      filter          = "resource.type=\"k8s_container\" AND resource.label.\"cluster_name\"=\"${var.vpc_name}-gke\" AND metric.type=\"kubernetes.io/container/restart_count\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.05
      duration        = "300s"

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.\"pod_name\""]
      }

      trigger {
        count = 1
      }
    }
  }

  documentation {
    content   = "Containers in the GKE cluster are restarting frequently. Inspect pod logs using `kubectl logs` or Cloud Logging."
    mime_type = "text/markdown"
  }

  depends_on = [
    google_project_service.monitoring,
    google_container_cluster.primary,
  ]
}

# Alert 4: a job waits for a runner for 10 minutes (the pool is full or does not scale up).
# The gha_* metrics come from the runner controller, collected by the PodMonitoring of arc-metrics.
resource "google_monitoring_alert_policy" "runner_jobs_waiting" {
  project      = var.project_id
  display_name = "${var.vpc_name}-runner-jobs-waiting"
  combiner     = "OR"

  notification_channels = [for channel in google_monitoring_notification_channel.email : channel.id]

  conditions {
    display_name = "Jobs assigned but not running for 10 minutes"

    condition_prometheus_query_language {
      query               = "sum(gha_assigned_jobs) - sum(gha_running_jobs) > 0"
      duration            = "600s"
      evaluation_interval = "60s"
    }
  }

  documentation {
    content   = "Workflow jobs are waiting for a self-hosted runner. Check the runner pool and the ARC listener in the Grafana cluster dashboard."
    mime_type = "text/markdown"
  }

  depends_on = [
    google_project_service.monitoring,
    google_container_cluster.primary,
  ]
}

# Alert 5: the hello function answers with server errors (5xx).
# Filtered by service name only, so this stack does not depend on the serverless stack.
resource "google_monitoring_alert_policy" "hello_errors" {
  project      = var.project_id
  display_name = "${var.vpc_name}-hello-errors"
  combiner     = "OR"

  notification_channels = [for channel in google_monitoring_notification_channel.email : channel.id]

  conditions {
    display_name = "hello returns 5xx responses"

    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND resource.label.\"service_name\"=\"hello\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.label.\"response_code_class\"=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "60s"

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }

      trigger {
        count = 1
      }
    }
  }

  documentation {
    content   = "The hello function returned 5xx responses. Read its logs in Logs Explorer, filtered on the service name."
    mime_type = "text/markdown"
  }

  depends_on = [google_project_service.monitoring]
}
