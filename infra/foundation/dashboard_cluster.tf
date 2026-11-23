/**
 * GKE Cluster & Runner Observability Dashboard (Issue #85)
 *
 * Visualizes the GKE cluster health, autoscaling behavior, and ARC GitHub Actions runners:
 * - Node count & autoscaling (default-pool and runner-pool)
 * - Pod count across namespaces
 * - CPU & Memory utilization
 * - ARC Runner activity (running vs pending runner pods)
 */

resource "google_monitoring_dashboard" "cluster_runners" {
  project = var.project_id
  dashboard_json = jsonencode({
    displayName = "GKE Cluster & Runners Dashboard (${var.environment})"
    gridLayout = {
      columns = 2
      widgets = [
        {
          title = "GKE Node Count (Autoscaling by Node Pool)"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"kubernetes.io/node/cpu/total_cores\" resource.type=\"k8s_node\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_MEAN"
                      crossSeriesReducer = "REDUCE_COUNT"
                      groupByFields      = ["metadata.user_labels.role"]
                    }
                  }
                }
              }
            ]
          }
        },
        {
          title = "ARC Runner Activity (Running vs Pending Pods in arc-runners)"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"kubernetes.io/container/cpu/core_usage_time\" resource.type=\"k8s_container\" resource.label.namespace_name=\"arc-runners\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_COUNT"
                      groupByFields      = ["resource.label.pod_name"]
                    }
                  }
                }
              }
            ]
          }
        },
        {
          title = "GKE CPU Allocation & Utilization"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"kubernetes.io/container/cpu/core_usage_time\" resource.type=\"k8s_container\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.label.namespace_name"]
                    }
                  }
                }
              }
            ]
          }
        },
        {
          title = "GKE Memory Working Set"
          xyChart = {
            dataSets = [
              {
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"kubernetes.io/container/memory/used_bytes\" resource.type=\"k8s_container\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_MEAN"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.label.namespace_name"]
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
