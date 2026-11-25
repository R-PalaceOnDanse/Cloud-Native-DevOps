# The GitHub credentials of the runner controller (ADR-0016, Issue #151).
# Terraform creates the secrets, never their values: a team member or org Owner adds them
# (see docs/infra.md). They live in this stack so that destroying `foundation` does not erase
# them, and `prevent_destroy` keeps it that way.

# Legacy runner personal access token (kept for transition or rollback)
resource "google_secret_manager_secret" "arc_github_token" {
  secret_id = "arc-github-token"

  replication {
    auto {}
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required]
}

# GitHub App credentials for ARC runner controller
resource "google_secret_manager_secret" "arc_github_app_id" {
  secret_id = "arc-github-app-id"

  replication {
    auto {}
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret" "arc_github_app_installation_id" {
  secret_id = "arc-github-app-installation-id"

  replication {
    auto {}
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret" "arc_github_app_private_key" {
  secret_id = "arc-github-app-private-key"

  replication {
    auto {}
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required]
}

