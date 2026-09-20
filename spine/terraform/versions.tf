terraform {
  # The floor both Terraform and OpenTofu meet (ADR-0016). Backends and locking are the root's.
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.80"
    }
  }
}
