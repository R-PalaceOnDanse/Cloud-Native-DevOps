data "google_project" "current" {
  project_id = var.project_id
}

# The budget lived on the previous billing account under the address google_billing_budget.main.
# It is forgotten (not deleted, the pipeline has no right there) and recreated on the current account.
removed {
  from = google_billing_budget.main

  lifecycle {
    destroy = false
  }
}

resource "google_billing_budget" "project" {
  billing_account = var.billing_account
  display_name    = var.project_id

  budget_filter {
    projects               = ["projects/${data.google_project.current.number}"]
    credit_types_treatment = "INCLUDE_ALL_CREDITS"
    calendar_period        = "MONTH"
  }

  amount {
    specified_amount {
      currency_code = "EUR"
      units         = tostring(var.budget_amount)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
    spend_basis       = "CURRENT_SPEND"
  }

  threshold_rules {
    threshold_percent = 0.9
    spend_basis       = "CURRENT_SPEND"
  }

  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "CURRENT_SPEND"
  }

  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }
}
