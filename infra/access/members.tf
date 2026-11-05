resource "google_project_iam_member" "instructor" {
  project = var.project_id
  role    = "roles/editor"
  member  = "user:${var.instructor_email}"
}

resource "google_billing_account_iam_member" "instructor_billing_viewer" {
  billing_account_id = var.billing_account
  role               = "roles/billing.viewer"
  member             = "user:${var.instructor_email}"
}

resource "google_project_iam_member" "team" {
  for_each = var.team_members

  project = var.project_id
  role    = "roles/owner"
  member  = "user:${each.value}"
}
