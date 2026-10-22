variable "project_id" {
  type        = string
  description = "cloud native teamPasX-cloudnative-dev"
  sensitive   = true
}

variable "region" {
  type        = string
  description = "Region of the ressources"
  sensitive   = true
}

variable "vpc_name" {
  type        = string
  description = "name of the vpc"
  sensitive   = true
}

variable "cidr_blok" {
  type        = string
  description = "CIDR block for the vpc"
  sensitive   = true
}