# Firestore Security Ruleset and Release
# Fulfills Issue #84 (C07 §3.3 & ADR-0008).
# Restricts client access to read-only for authenticated users; denies all client writes.

resource "google_firebaserules_ruleset" "firestore" {
  project = var.project_id

  source {
    files {
      name    = "firestore.rules"
      content = file("${path.module}/firestore.rules")
    }
  }

  depends_on = [
    google_project_service.serverless,
    google_firestore_database.canvas
  ]
}

resource "google_firebaserules_release" "firestore" {
  project      = var.project_id
  name         = "cloud.firestore"
  ruleset_name = google_firebaserules_ruleset.firestore.name

  depends_on = [
    google_firebaserules_ruleset.firestore
  ]
}
