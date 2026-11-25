# Cloud Monitoring Dashboard and Alerts for the GKE cluster and runners (ADR-0010)

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
