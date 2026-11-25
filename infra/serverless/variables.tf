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

variable "worker_max_instances" {
  type        = number
  description = "Maximum number of draw-worker instances: Pub/Sub buffers the rest (cost safeguard, scaling demo)."
  default     = 10

  validation {
    condition     = var.worker_max_instances >= 1 && var.worker_max_instances <= 50
    error_message = "worker_max_instances must be between 1 and 50."
  }
}

variable "discord_client_id" {
  type        = string
  description = "Application (client) ID of the Discord application, used for OAuth2. Public, not a secret."
  default     = ""
}

variable "admin_user_ids" {
  type        = list(string)
  description = "Discord user IDs allowed to run /admin and /snapshot (on top of admin_role_id and config/system.admins)."
  default     = []
}

variable "admin_role_id" {
  type        = string
  description = "Discord role ID whose members are admins. Empty: only admin_user_ids."
  default     = ""
}

variable "frontend_origin" {
  type        = string
  description = "Origin of the web frontend (CORS, OAuth2 redirect). Empty: the default Firebase Hosting domain of the project."
  default     = ""
}

locals {
  frontend_origin = var.frontend_origin != "" ? var.frontend_origin : "https://${var.project_id}.web.app"
}

variable "discord_proxy_max_instances" {
  type        = number
  description = "Maximum number of instances of the Discord proxy function: a cost safeguard."
  default     = 3

  validation {
    condition     = var.discord_proxy_max_instances >= 1 && var.discord_proxy_max_instances <= 10
    error_message = "discord_proxy_max_instances must be between 1 and 10."
  }
}
