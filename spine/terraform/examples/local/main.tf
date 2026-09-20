# The spine against a LocalStack stand-in (ADR-0017 §3): the same module the demo root calls, with
# the provider pointed at localhost:4566 and `local_stand_in = true`. Local state, disposable. This
# is what a public repository's CI applies on every pull request and what `deploy/local` in a tenant
# repository looks like. Nothing here reaches an account; the credentials are LocalStack's fixtures.

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.80"
    }
  }
}

variable "endpoint" {
  description = "Where LocalStack listens. A service container in CI, `scripts/deploy.sh local-up` elsewhere."
  type        = string
  default     = "http://localhost:4566"
}

variable "sealer_package" {
  type    = string
  default = "../../../bundle/sealer.zip"
}

# Provider blocks cannot be conditional, which is why this root exists beside examples/demo rather
# than as a flag on it. Every service the module touches is listed; anything else would go to AWS.
provider "aws" {
  region     = "eu-west-1"
  access_key = "test"
  secret_key = "test"

  skip_credentials_validation = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
  s3_use_path_style           = true

  endpoints {
    s3         = var.endpoint
    sns        = var.endpoint
    iam        = var.endpoint
    lambda     = var.endpoint
    scheduler  = var.endpoint
    logs       = var.endpoint
    cloudwatch = var.endpoint
    sts        = var.endpoint
  }
}

module "spine" {
  source = "../.."

  name                = "aannemer-x"
  archive_bucket_name = "aannemer-x-maestro-archive"
  digest_contacts     = ["ops@aannemer-x.example"]
  sealer_package      = abspath(var.sealer_package)
  local_stand_in      = true

  tags = { "maestro:tenant" = "aannemer-x" }
}

output "relay_environment" {
  value = module.spine.relay_environment
}
