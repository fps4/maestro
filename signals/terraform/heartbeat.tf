# The optional heartbeat: a metric the application emits so silence is detectable (docs/signals.md).
# Nothing in the application produces a metric on its own schedule, so the module does: a
# twenty-line Lambda on EventBridge Scheduler puts one datapoint on maestro/heartbeat every five
# minutes, and an alarm that treats a missing datapoint as breaching turns three missed beats into
# a signal on the topic. One invocation per five minutes is the whole cost.

locals {
  heartbeat_name      = "${local.name}-heartbeat"
  heartbeat_namespace = "maestro/heartbeat"
  heartbeat_metric    = "Heartbeat"
  heartbeat_dimensions = {
    application = var.application
    environment = var.environment
  }
}

data "archive_file" "heartbeat" {
  count       = var.heartbeat ? 1 : 0
  type        = "zip"
  source_file = "${path.module}/heartbeat/index.js"
  output_path = "${path.module}/bundle/heartbeat.zip"
}

resource "aws_iam_role" "heartbeat" {
  count = var.heartbeat ? 1 : 0
  name  = local.heartbeat_name
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.tags
}

# One action, one namespace. No log group: the silence alarm is the heartbeat's observer, and a
# beat that fails is a missed beat, not a log line.
resource "aws_iam_role_policy" "heartbeat" {
  count = var.heartbeat ? 1 : 0
  name  = "put-heartbeat"
  role  = aws_iam_role.heartbeat[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = ["cloudwatch:PutMetricData"]
      Resource  = "*"
      Condition = { StringEquals = { "cloudwatch:namespace" = local.heartbeat_namespace } }
    }]
  })
}

resource "aws_lambda_function" "heartbeat" {
  count            = var.heartbeat ? 1 : 0
  function_name    = local.heartbeat_name
  description      = "maestro heartbeat for ${var.application} ${var.environment}: one datapoint every five minutes"
  role             = aws_iam_role.heartbeat[0].arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.heartbeat[0].output_path
  source_code_hash = data.archive_file.heartbeat[0].output_base64sha256
  timeout          = 10
  memory_size      = 128
  tags             = local.tags

  environment {
    variables = {
      APPLICATION = var.application
      ENVIRONMENT = var.environment
    }
  }

  depends_on = [aws_iam_role_policy.heartbeat]
}

resource "aws_iam_role" "heartbeat_schedule" {
  count = var.heartbeat ? 1 : 0
  name  = "${local.heartbeat_name}-schedule"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy" "heartbeat_schedule" {
  count = var.heartbeat ? 1 : 0
  name  = "invoke-heartbeat"
  role  = aws_iam_role.heartbeat_schedule[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = aws_lambda_function.heartbeat[0].arn
    }]
  })
}

resource "aws_scheduler_schedule" "heartbeat" {
  count               = var.heartbeat ? 1 : 0
  name                = local.heartbeat_name
  description         = "maestro heartbeat for ${var.application} ${var.environment}"
  schedule_expression = "rate(5 minutes)"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.heartbeat[0].arn
    role_arn = aws_iam_role.heartbeat_schedule[0].arn
    # A beat retried past its own window is a late beat, not a heartbeat.
    retry_policy {
      maximum_retry_attempts       = 2
      maximum_event_age_in_seconds = 240
    }
  }
}

# Silence. Three beats fall in every period; fewer than one is an alarm, and no datapoint at all
# is the same alarm — that is what makes an application that has stopped reporting visible.
resource "aws_cloudwatch_metric_alarm" "silence" {
  count               = var.heartbeat ? 1 : 0
  alarm_name          = "${local.name}-silence"
  alarm_description   = "No heartbeat from ${var.application} ${var.environment} in fifteen minutes."
  namespace           = local.heartbeat_namespace
  metric_name         = local.heartbeat_metric
  dimensions          = local.heartbeat_dimensions
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.ops_signals.arn]
  ok_actions          = [aws_sns_topic.ops_signals.arn]
  tags                = local.tags
}
