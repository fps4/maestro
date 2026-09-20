# app1's production environment applying the module, as its own infrastructure code would. This is
# what onboarding at N1 looks like from the application's side: the module, and one of its own
# alarms wired to the topic on both transitions. Nothing here is deployed by the public
# repositories; the maestro account id comes from the application's tfvars.

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

variable "maestro_account_id" {
  description = "The account maestro runs in. Set in terraform.tfvars, which stays out of any repository."
  type        = string
}

module "signals" {
  source = "../.."

  application        = "app1"
  environment        = "production"
  tier               = "tier1"
  maestro_account_id = var.maestro_account_id

  tags = { "cost-centre" = "app1" }
}

# An alarm the application owns — its threshold, its period. ALARM and OK both reach the topic:
# the OK is what lets maestro close the item on evidence.
resource "aws_cloudwatch_metric_alarm" "api_errors" {
  alarm_name          = "app1-production-api-errors"
  alarm_description   = "app1's API function is erroring."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = "app1-production-api" }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 5
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = module.signals.alarm_actions
  ok_actions          = module.signals.ok_actions
  tags                = module.signals.tags
}

output "topic_arn" {
  description = "What the tenant records in applications/app1.yaml so maestro can subscribe."
  value       = module.signals.topic_arn
}
