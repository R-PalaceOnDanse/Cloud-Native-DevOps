# Private GCS bucket for timestamped canvas snapshots (Issue #135 / C07 §2)
resource "google_storage_bucket" "snapshots" {
  name                        = "${var.project_id}-canvas-snapshots"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = true # disposable for clean tear-down

  lifecycle_rule {
    condition {
      age = 30 # Auto-delete old snapshots after 30 days
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.serverless]
}
