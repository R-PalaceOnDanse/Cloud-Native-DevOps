# Terraform creates the secret, never its value: the value would otherwise sit in the state and in
# the plan. A team member adds the value once per environment (see docs/serverless.md).
resource "google_secret_manager_secret" "hello_greeting" {
  secret_id = "hello-greeting"

  replication {
    auto {}
  }

  depends_on = [google_project_service.serverless]
}

# Only the hello function may read it.
resource "google_secret_manager_secret_iam_member" "hello_reads_greeting" {
  secret_id = google_secret_manager_secret.hello_greeting.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.hello.email}"
}
