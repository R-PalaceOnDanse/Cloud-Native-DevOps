# Images of the functions (#171). Without docker_repository, Cloud Functions creates `gcf-artifacts`
# outside Terraform: it survives a destroy and its images keep being billed. Managed here, the
# repository and every image in it are deleted with the stack.
resource "google_artifact_registry_repository" "functions" {
  repository_id = "functions"
  location      = var.region
  format        = "DOCKER"
  description   = "Images built by Cloud Build for the Cloud Run functions of this stack."

  # Each deployment adds an image: keep the recent ones for a rollback, drop the rest.
  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 3
    }
  }
  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "604800s" # 7 days
    }
  }

  depends_on = [google_project_service.serverless]
}
