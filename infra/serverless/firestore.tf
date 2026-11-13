# Firestore Native-mode database for the pixel grid (chunks) and user rate-limit counters.
# Resolves #134.

resource "google_firestore_database" "canvas" {
  project                     = var.project_id
  name                        = "(default)"
  location_id                 = var.region
  type                        = "FIRESTORE_NATIVE"
  delete_protection_state     = "DELETE_PROTECTION_DISABLED"
  deletion_policy             = "DELETE"
  app_engine_integration_mode = "DISABLED"

  depends_on = [google_project_service.serverless]
}

