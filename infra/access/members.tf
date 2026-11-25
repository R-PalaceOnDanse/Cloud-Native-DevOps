resource "google_project_iam_member" "instructor" {
  project = var.project_id
  role    = "roles/editor"
  member  = "user:${var.instructor_email}"
}

# Billing viewer of the instructor on the billing account of the projects (the free-credit account).
# Managed as code (subject §1.2): github-plan and github-apply have billing rights on this account.
# New address so that Terraform never reads the previous account.
resource "google_billing_account_iam_member" "instructor_billing_viewer_account" {
  billing_account_id = var.billing_account
  role               = "roles/billing.viewer"
  member             = "user:${var.instructor_email}"
}

# The binding on the previous billing account is only forgotten, not deleted: the pipeline has no
# right on that account. A billing admin removes it by hand if needed.
removed {
  from = google_billing_account_iam_member.instructor_billing_viewer

  lifecycle {
    destroy = false
  }
}

resource "google_project_iam_member" "team" {
  for_each = var.team_members

  project = var.project_id
  role    = "roles/owner"
  member  = "user:${each.value}"
}
