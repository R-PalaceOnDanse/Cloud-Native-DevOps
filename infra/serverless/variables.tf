variable "project_id" {
  type        = string
  description = "ID of the GCP project of the environment, for example teampasx-cloudnative-dev."
}

variable "region" {
  type        = string
  description = "GCP region of the functions and of the gateway. Must support API Gateway (europe-west1)."
}

variable "hello_max_instances" {
  type        = number
  description = "Maximum number of instances of the hello function: a cost safeguard."
  default     = 3

  validation {
    condition     = var.hello_max_instances >= 1 && var.hello_max_instances <= 10
    error_message = "hello_max_instances must be between 1 and 10."
  }
}
