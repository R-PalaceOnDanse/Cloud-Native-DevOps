variable "project_id" {
  type        = string
  description = "ID of the GCP project of the environment, for example teampasx-cloudnative-dev."
}

variable "region" {
  type        = string
  description = "GCP region used by the provider."
}

variable "environment" {
  type        = string
  description = "Name of the environment, which is also the name of the GitHub environment allowed to apply."

  validation {
    condition     = contains(["dev", "prd"], var.environment)
    error_message = "environment must be dev or prd."
  }
}

variable "github_repository" {
  type        = string
  description = "GitHub repository allowed to authenticate, as owner/name."

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must look like owner/name."
  }
}

variable "state_bucket" {
  type        = string
  description = "Name of the Terraform state bucket of the environment. Must match the bucket in backends/<env>.hcl."
}
