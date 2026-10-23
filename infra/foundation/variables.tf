variable "project_id" {
  type        = string
  description = "ID of the GCP project of the environment, for example teampasx-cloudnative-dev."
}

variable "region" {
  type        = string
  description = "GCP region of the regional resources."
}

variable "vpc_name" {
  type        = string
  description = "Name of the VPC network."
}

variable "subnet_cidr" {
  type        = string
  description = "IPv4 range of the subnet, in CIDR notation. Must not overlap the other environment."

  validation {
    condition     = can(cidrnetmask(var.subnet_cidr))
    error_message = "subnet_cidr must be a valid IPv4 CIDR block, for example 10.10.0.0/24."
  }
}
