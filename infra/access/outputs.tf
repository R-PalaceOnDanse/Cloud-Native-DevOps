output "workload_identity_provider" {
  value       = google_iam_workload_identity_pool_provider.github.name
  description = "Full name of the provider, for the workload_identity_provider input of google-github-actions/auth."
}

output "plan_service_account" {
  value       = google_service_account.plan.email
  description = "Email of the read-only service account used by plans."
}

output "apply_service_account" {
  value       = google_service_account.apply.email
  description = "Email of the service account used by apply and destroy."
}

output "budget_id" {
  value       = google_billing_budget.main.id
  description = "Resource name of the GCP billing budget."
}
