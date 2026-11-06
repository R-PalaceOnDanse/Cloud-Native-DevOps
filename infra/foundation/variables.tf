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

variable "pods_cidr" {
  type        = string
  description = "Secondary IPv4 range for GKE pods, in CIDR notation. Must not overlap the other environment."

  validation {
    condition     = can(cidrnetmask(var.pods_cidr))
    error_message = "pods_cidr must be a valid IPv4 CIDR block, for example 10.11.0.0/16."
  }
}

variable "services_cidr" {
  type        = string
  description = "Secondary IPv4 range for GKE services, in CIDR notation. Must not overlap the other environment."

  validation {
    condition     = can(cidrnetmask(var.services_cidr))
    error_message = "services_cidr must be a valid IPv4 CIDR block, for example 10.12.0.0/20."
  }
}

variable "github_token" {
  description = "Token GitHub to authorize runners to register themselves."
  type        = string
  sensitive   = true
}

variable "environment" {
  type        = string
  description = "Name of the environment, which is also the name of the GitHub environment allowed to apply."

  validation {
    condition     = contains(["dev", "prd"], var.environment)
    error_message = "environment must be dev or prd."
  }
}