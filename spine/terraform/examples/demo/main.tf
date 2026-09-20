# The demo tenant's spine, as a root would call it. Placeholder values only (ADR-0017): nothing here
# is deployed by the public repositories. A real tenant's root lives in fps4/maestro-config-<tenant>.

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

variable "region" {
  type    = string
  default = "eu-west-1"
}

module "spine" {
  source = "../.."

  name                = "aannemer-x"
  archive_bucket_name = "aannemer-x-maestro-archive"
  digest_contacts     = ["ops@aannemer-x.example"]
  sealer_package      = "${path.module}/../../../dist/lambda/sealer.zip"

  tags = { "maestro:tenant" = "aannemer-x" }
}

output "relay_environment" {
  value = module.spine.relay_environment
}
