terraform {
  required_version = "~> 1.9.0"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 7.0" }
    # API Gateway resources only exist in the beta provider.
    google-beta = { source = "hashicorp/google-beta", version = "~> 7.0" }
    # Zips the function source before uploading it.
    archive = { source = "hashicorp/archive", version = "~> 2.7" }
  }
}

provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

provider "google-beta" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}
