variable "project" {
  type        = string
  description = "Project name prefix"
  default     = "demo"
}

variable "suffix" {
  type        = string
  description = "Unique suffix to avoid name clashes"
  default     = "dev"
}

variable "aws_region" {
  type        = string
  description = "AWS region"
  default     = "us-east-1"
}

