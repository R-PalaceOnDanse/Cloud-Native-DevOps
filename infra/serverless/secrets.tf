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

resource "google_secret_manager_secret" "discord_public_key" {
  secret_id = "discord-public-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.serverless]
}

resource "google_secret_manager_secret_iam_member" "discord_proxy_reads_public_key" {
  secret_id = google_secret_manager_secret.discord_public_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.discord_proxy.email}"
}

# OAuth2 client secret of the Discord application. Value added once per environment:
#   printf '%s' "<secret>" | gcloud secrets versions add discord-client-secret --data-file=- --project <project>
resource "google_secret_manager_secret" "discord_client_secret" {
  secret_id = "discord-client-secret"

  replication {
    auto {}
  }

  depends_on = [google_project_service.serverless]
}

# Only auth-callback may read it, at request time (DISCORD_CLIENT_SECRET_VERSION).
resource "google_secret_manager_secret_iam_member" "auth_callback_reads_client_secret" {
  secret_id = google_secret_manager_secret.discord_client_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.auth_callback.email}"
}
