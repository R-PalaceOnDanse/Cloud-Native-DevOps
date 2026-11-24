# The admin password of Grafana (ADR-0021). Terraform creates the secret, never its value: a team
# member adds it (see docs/infra.md). It lives in this stack so that destroying `foundation` does not
# erase the value.
resource "google_secret_manager_secret" "grafana_admin_password" {
  secret_id = "grafana-admin-password"

  replication {
    auto {}
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.required]
}
