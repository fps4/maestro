terraform {
  # The floor both Terraform and OpenTofu meet (ADR-0016). Backends and locking are the root's.
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.80"
      # CloudFront's certificate and the Lambda@Edge signer live in us-east-1 whatever the
      # deployment's region; the root passes a second configuration for it.
      configuration_aliases = [aws.us_east_1]
    }
    archive = {
      source  = "hashicorp/archive"
      version = ">= 2.4"
    }
  }
}
