# The demo tenant's specs-service, as a root would call it: the spine's module at a tag, and this
# one composed with its outputs. Placeholder values only (maestro ADR-0017): nothing here is deployed
# by the public repositories. A real tenant's root lives in fps4/maestro-config-<tenant>, with the
# database URI in Secrets Manager and the values below in its terraform.tfvars.

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
  source = "github.com/fps4/maestro//spine/terraform?ref=spine-v0.2.0"

  name                = "aannemer-x"
  archive_bucket_name = "aannemer-x-maestro-archive"
  archive_prefix      = "specs/"
  digest_contacts     = ["ops@aannemer-x.example"]
  sealer_package      = "${path.module}/sealer.zip"

  tags = { "maestro:tenant" = "aannemer-x" }
}

resource "aws_secretsmanager_secret" "mongo_uri" {
  name = "aannemer-x/specs/mongo-uri"
}

module "specs" {
  source = "../.."

  name                  = "aannemer-x-specs"
  bucket_name           = "aannemer-x-maestro-specs"
  api_package           = "${path.module}/../../../api/bundle/api.zip"
  relay_package         = "${path.module}/../../../api/bundle/relay.zip"
  web_adapter_layer_arn = var.web_adapter_layer_arn

  environment = {
    AUTH_MODE     = "jwks"
    AUTH_JWKS_URL = "https://identity.aannemer-x.example/realms/aannemer-x/protocol/openid-connect/certs"
    AUTH_ISSUER   = "https://identity.aannemer-x.example/realms/aannemer-x"
    AUTH_AUDIENCE = "specs"
    CORS_ORIGINS  = "https://specs.aannemer-x.example"
  }

  secrets = {
    MONGO_URI = aws_secretsmanager_secret.mongo_uri.arn
  }

  archive = {
    relay_environment = module.spine.relay_environment
    relay_policy_json = module.spine.relay_policy_json
  }

  tags = { "maestro:tenant" = "aannemer-x" }
}

output "api_url" {
  value = module.specs.api_url
}
