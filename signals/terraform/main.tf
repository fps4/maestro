# The application-side half of the signals contract (docs/signals.md, ADR-0012): one ops-signals
# topic per application per environment, its policy, and the tag schema. Alarms stay the
# application's; they reach the topic through the alarm_actions and ok_actions outputs.

data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}

locals {
  name = "${var.application}-${var.environment}"

  # The tag schema. A signal identifies its instance from these without a lookup, so the module's
  # values win over anything passed in.
  tags = merge(var.tags, {
    "maestro:application" = var.application
    "maestro:environment" = var.environment
    "maestro:tier"        = var.tier
  })

  # Built from the partition and the id, never written as a literal: a public repository holds no
  # account id; the application's tfvars do.
  maestro_principal = "arn:${data.aws_partition.current.partition}:iam::${var.maestro_account_id}:root"
  this_principal    = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"
}

# --- the topic -----------------------------------------------------------------------------------

resource "aws_sns_topic" "ops_signals" {
  name = "${local.name}-ops-signals"
  tags = local.tags
}

# The topic is the application's public ops interface. Alarms in this account publish to it; the
# application's own monitor and anything else in this account may publish and subscribe; the
# maestro account may subscribe and look. Nothing outside these two accounts is admitted.
resource "aws_sns_topic_policy" "ops_signals" {
  arn = aws_sns_topic.ops_signals.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "CloudWatchAlarmsPublish"
        Effect    = "Allow"
        Principal = { Service = "cloudwatch.amazonaws.com" }
        Action    = "sns:Publish"
        Resource  = aws_sns_topic.ops_signals.arn
        Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
      },
      {
        Sid       = "ThisAccountPublishesAndSubscribes"
        Effect    = "Allow"
        Principal = { AWS = local.this_principal }
        Action    = ["sns:Publish", "sns:Subscribe", "sns:GetTopicAttributes", "sns:ListSubscriptionsByTopic"]
        Resource  = aws_sns_topic.ops_signals.arn
      },
      {
        Sid       = "MaestroSubscribes"
        Effect    = "Allow"
        Principal = { AWS = local.maestro_principal }
        Action    = ["sns:Subscribe", "sns:GetTopicAttributes", "sns:ListSubscriptionsByTopic"]
        Resource  = aws_sns_topic.ops_signals.arn
      },
    ]
  })
}
