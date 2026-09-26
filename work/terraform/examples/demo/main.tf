# The demo tenant's work-service, as a root would call it: the spine's module from this repository, and this
# one composed with its outputs. Placeholder values only (maestro ADR-0017): nothing here is deployed
# by the public repositories. A real tenant's root lives in fps4/maestro-<tenant>, with the
# values below in its terraform.tfvars. No database credential exists: the module makes the table
# and grants the functions (maestro ADR-0018).

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

variable "web_adapter_layer_arn" {
  description = "The Lambda Web Adapter layer for the region, arm64 — see the README for where AWS lists it."
  type        = string
  default     = "arn:aws:lambda:eu-west-1:<aws-account-id>:layer:LambdaAdapterLayerArm64:30"
}

module "spine" {
  source = "../../../../spine/terraform"

  name                = "aannemer-x"
  archive_bucket_name = "aannemer-x-maestro-archive"
  archive_prefix      = "work/"
  digest_contacts     = ["ops@aannemer-x.example"]
  sealer_package      = "${path.module}/sealer.zip"

  tags = { "maestro:tenant" = "aannemer-x" }
}

module "work" {
  source = "../.."

  name                  = "aannemer-x-work"
  table_name            = "aannemer-x-maestro-work"
  bucket_name           = "aannemer-x-maestro-work"
  api_package           = "${path.module}/../../../api/bundle/api.zip"
  relay_package         = "${path.module}/../../../api/bundle/relay.zip"
  sweep_package         = "${path.module}/../../../api/bundle/sweep.zip"
  sweep_principal       = "prn-w-work-demo"
  web_adapter_layer_arn = var.web_adapter_layer_arn

  environment = {
    AUTH_MODE     = "jwks"
    AUTH_JWKS_URL = "https://identity.aannemer-x.example/realms/aannemer-x/protocol/openid-connect/certs"
    AUTH_ISSUER   = "https://identity.aannemer-x.example/realms/aannemer-x"
    AUTH_AUDIENCE = "work"
    CORS_ORIGINS  = "https://work.aannemer-x.example"
  }

  archive = {
    relay_environment = module.spine.relay_environment
    relay_policy_json = module.spine.relay_policy_json
  }

  tags = { "maestro:tenant" = "aannemer-x" }
}

output "api_url" {
  value = module.work.api_url
}

output "table_name" {
  value = module.work.table_name
}
