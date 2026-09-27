# The demo tenant's runtime-service, as a root would call it: the spine's module from this repository,
# and this one composed with its outputs. Placeholder values only (maestro ADR-0017): nothing here is
# deployed by the public repositories. A real tenant's root lives in fps4/maestro-<tenant>, with the
# values below in its terraform.tfvars. No database credential exists: the module makes the table and
# grants the functions (maestro ADR-0018).

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
  archive_prefix      = "runtime/"
  digest_contacts     = ["ops@aannemer-x.example"]
  sealer_package      = "${path.module}/sealer.zip"

  tags = { "maestro:tenant" = "aannemer-x" }
}

module "runtime" {
  source = "../.."

  name                  = "aannemer-x-runtime"
  table_name            = "aannemer-x-maestro-runtime"
  bucket_name           = "aannemer-x-maestro-runtime"
  api_package           = "${path.module}/../../../api/bundle/api.zip"
  relay_package         = "${path.module}/../../../api/bundle/relay.zip"
  intake_package        = "${path.module}/../../../api/bundle/intake.zip"
  web_adapter_layer_arn = var.web_adapter_layer_arn

  environment = {
    AUTH_MODE     = "jwks"
    AUTH_JWKS_URL = "https://identity.aannemer-x.example/.well-known/jwks.json"
    AUTH_ISSUER   = "https://identity.aannemer-x.example"
    AUTH_AUDIENCE = "maestro"
    CORS_ORIGINS  = "https://maestro.aannemer-x.example"
  }

  # Build records and deploys off the default bus, taken in as this workload.
  intake = {
    principal = "prn-w-runtime-intake-demo"
    workspace = "aannemer-x"
  }

  # A digest mismatch reaches work-service's intake as a signal (ADR-0027 §5).
  signals = {
    work_api_url = "https://work.aannemer-x.example"
    token_url    = "https://identity.aannemer-x.example/oauth2/token"
    client_id    = "maestro-runtime-signals"
  }
  secrets = {
    SIGNALS_CLIENT_SECRET = "arn:aws:secretsmanager:eu-west-1:<aws-account-id>:secret:aannemer-x/runtime/signals"
  }

  archive = {
    relay_environment = module.spine.relay_environment
    relay_policy_json = module.spine.relay_policy_json
  }
  archive_prefix = "runtime/"

  tags = { "maestro:tenant" = "aannemer-x" }
}

output "api_url" {
  value = module.runtime.api_url
}

output "sbom_bucket_arn" {
  description = "Grant each application's pipeline role s3:PutObject on <arn>/sbom/<application>/*."
  value       = module.runtime.bucket_arn
}
