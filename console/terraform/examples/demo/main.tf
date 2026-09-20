# The demo tenant's specs-service console, as a root would call it. Placeholder values only
# (ADR-0017): nothing here is deployed by the public repositories. A real tenant's root lives in
# fps4/maestro-config-<tenant> and calls the module once per console.

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.80"
    }
  }
}

provider "aws" {
  region = var.region
}

# CloudFront reads certificates from us-east-1 only, and Lambda@Edge runs from there: the module
# takes this second configuration whatever the deployment's region.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

variable "region" {
  type    = string
  default = "eu-west-1"
}

variable "open_next_dir" {
  description = "The console's `.open-next/`, as `npx @opennextjs/aws build` left it. In a tenant repository the pipeline's checkout-components.sh builds it under components/<component>/ (ADR-0017); here the default is a placeholder beside this checkout."
  type        = string
  default     = "../../../../maestro-specs/web/.open-next"
}

module "specs_console" {
  source = "../.."
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  name               = "aannemer-x-specs-console"
  open_next_dir      = var.open_next_dir
  assets_bucket_name = "aannemer-x-specs-console-assets"

  # Read by the server at request time. NEXT_PUBLIC_* values were baked in at the build step.
  environment = {
    API_PROXY_TARGET = "https://specs-api.aannemer-x.example"
  }

  # A domain needs a certificate issued in us-east-1, through the aws.us_east_1 configuration:
  #   resource "aws_acm_certificate" "specs" { provider = aws.us_east_1  domain_name = "specs.aannemer-x.example"  validation_method = "DNS" }
  # domain          = "specs.aannemer-x.example"
  # certificate_arn = aws_acm_certificate.specs.arn

  tags = { "maestro:tenant" = "aannemer-x", "maestro:component" = "specs-service" }
}

output "url" {
  value = module.specs_console.url
}

# DNS is the root's: a Route 53 alias, or a CNAME elsewhere, from the domain to this name.
output "distribution_domain_name" {
  value = module.specs_console.distribution_domain_name
}
