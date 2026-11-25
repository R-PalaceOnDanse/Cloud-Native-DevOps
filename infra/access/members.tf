resource "google_project_iam_member" "instructor" {
  project = var.project_id
  role    = "roles/editor"
  member  = "user:${var.instructor_email}"
}

# The instructor's billing viewer role is on the shared billing account, not on the project: the
# plan account cannot read that policy, so every plan of this stack failed. It is granted by hand
# (docs/environments.md). Terraform forgets it at the next apply and leaves it in place.
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
