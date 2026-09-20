# A tenant repository's deploy/local, as the reusable workflow sees it (tenancy-and-config.md):
# pipeline.yml calls tenant-deploy.yml with target local and root .github/self-test/deploy, so the
# shape is proven end to end on every pull request — the runner expression, the service container,
# the component checkout and build, plan and apply through deploy.sh. The module and the sealer's
# bundle come from components/maestro, which the workflow checked out at the tag the caller named.
# Placeholder values only; nothing here reaches an account.

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
  type    = string
  default = "http://localhost:4566"
}

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
  source = "../../../../components/maestro/spine/terraform"

  name                = "aannemer-x"
  archive_bucket_name = "aannemer-x-maestro-archive"
  digest_contacts     = ["ops@aannemer-x.example"]
  sealer_package      = abspath("${path.module}/../../../../components/maestro/spine/bundle/sealer.zip")
  local_stand_in      = true

  tags = { "maestro:tenant" = "aannemer-x" }
}

output "relay_environment" {
  value = module.spine.relay_environment
}
