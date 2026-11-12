# The GitHub token of the runner controller (ADR-0016). Terraform creates the secret, never its
# value: a team member adds it (see docs/infra.md). It lives in this stack so that destroying
# `foundation` does not erase the value, and `prevent_destroy` keeps it that way.
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
