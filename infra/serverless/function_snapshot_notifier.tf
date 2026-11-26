# Snapshot notifier Cloud Function (Issue #169 / C07 §2). Triggered by the ObjectCreated event of the
# snapshots bucket through the snapshot-ready topic (pubsub.tf), never called by the worker.

data "archive_file" "snapshot_notifier" {
  type        = "zip"
  source_dir  = "${path.module}/../../app/functions/snapshot-notifier"
  output_path = "${path.module}/.build/snapshot-notifier.zip"
  excludes    = ["node_modules", "dist"]
}

resource "google_storage_bucket_object" "snapshot_notifier" {
  name   = "snapshot-notifier/${data.archive_file.snapshot_notifier.output_md5}.zip"
  bucket = google_storage_bucket.sources.name
  source = data.archive_file.snapshot_notifier.output_path
}

resource "google_cloudfunctions2_function" "snapshot_notifier" {
  name        = "snapshot-notifier"
  location    = var.region
  description = "Signs a 1 hour read URL for each new snapshot and edits the Discord answer."

  build_config {
    runtime           = "nodejs22"
    entry_point       = "snapshotNotifier"
    service_account   = google_service_account.build.id
    docker_repository = google_artifact_registry_repository.functions.id

    source {
      storage_source {
        bucket = google_storage_bucket.sources.name
        object = google_storage_bucket_object.snapshot_notifier.name
      }
    }
  }

  service_config {
    service_account_email = google_service_account.snapshot_notifier.email
    min_instance_count    = 0
    # Snapshots are rare admin commands: two instances are plenty, Pub/Sub buffers the rest.
    max_instance_count             = 2
    available_memory               = "256M"
    timeout_seconds                = 30
    all_traffic_on_latest_revision = true
    # Only reachable from Google services of the project (the Pub/Sub push), never from the internet.
    ingress_settings = "ALLOW_INTERNAL_ONLY"

    environment_variables = {
      GOOGLE_CLOUD_PROJECT = var.project_id
    }
  }

  depends_on = [
    google_project_service.serverless,
    google_project_iam_member.build,
  ]
}
