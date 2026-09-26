# The demo tenant's console, as a root would call it. Placeholder values only (ADR-0017): nothing
# here is deployed by the public repositories. A real tenant's root lives in fps4/maestro-<tenant>.

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
  region = "eu-central-1"
}

variable "package" {
  description = "The console's zip, as `npm run build && npm run bundle` in console/web left it."
  type        = string
  default     = "../../tests/fixtures/console.zip"
}

# The host name's certificate is issued in the deployment's region and validated by a DNS record the
# tenant adds where its zone is (Cloudflare, say). Pass it to the module once it is ISSUED:
#   resource "aws_acm_certificate" "console" { domain_name = "maestro.aannemer-x.example"  validation_method = "DNS" }

module "console" {
  source = "../.."

  name                  = "aannemer-x-console"
  package               = var.package
  web_adapter_layer_arn = "arn:aws:lambda:eu-central-1:aws:layer:LambdaAdapterLayerArm64:25"

  # Read by the server at request time. NEXT_PUBLIC_* values were baked in at the build.
  environment = {
    API_PROXY_TARGET = "https://specs-api.aannemer-x.example"
  }

  # domain          = "maestro.aannemer-x.example"
  # certificate_arn = aws_acm_certificate.console.arn

  tags = { "maestro:tenant" = "aannemer-x" }
}

output "url" {
  value = module.console.url
}
