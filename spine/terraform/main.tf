# The spine on AWS: the archive bucket, the events topic, the digests topic and the sealer.
# Relays belong to the components that own an outbox; their modules attach `relay_policy_json` and
# set ARCHIVE_BUCKET / ARCHIVE_PREFIX / EVENTS_TOPIC_ARN from this module's outputs.

locals {
  tags = merge({ "maestro:component" = "spine" }, var.tags)
}

# --- the archive ---------------------------------------------------------------------------------

resource "aws_s3_bucket" "archive" {
  bucket              = var.archive_bucket_name
  object_lock_enabled = true
  tags                = local.tags

  # The record. A refactor moves this with a `moved` block; nothing replaces it.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "archive" {
  bucket = aws_s3_bucket.archive.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "archive" {
  bucket = aws_s3_bucket.archive.id
  rule {
    default_retention {
      mode = var.object_lock_mode
      days = var.object_lock_retention_days
    }
  }
  depends_on = [aws_s3_bucket_versioning.archive]

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "archive" {
  bucket                  = aws_s3_bucket.archive.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "archive" {
  bucket = aws_s3_bucket.archive.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "archive" {
  bucket = aws_s3_bucket.archive.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# Two denies for everyone: no plaintext transport, and nobody bypasses governance retention. The
# break-glass path is the account root editing this policy — a deliberate, logged act.
resource "aws_s3_bucket_policy" "archive" {
  bucket = aws_s3_bucket.archive.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.archive.arn, "${aws_s3_bucket.archive.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
      {
        Sid       = "DenyRetentionBypass"
        Effect    = "Deny"
        Principal = "*"
        Action    = ["s3:BypassGovernanceRetention"]
        Resource  = "${aws_s3_bucket.archive.arn}/*"
      },
    ]
  })
  depends_on = [aws_s3_bucket_public_access_block.archive]
}

# --- delivery ------------------------------------------------------------------------------------

resource "aws_sns_topic" "events" {
  name                        = "${var.name}-spine-events.fifo"
  fifo_topic                  = true
  content_based_deduplication = false # the relay sets MessageDeduplicationId = event_id
  tags                        = local.tags
}

resource "aws_sns_topic" "digests" {
  name = "${var.name}-spine-digests"
  tags = local.tags
}

resource "aws_sns_topic_subscription" "digest" {
  for_each  = toset(var.digest_contacts)
  topic_arn = aws_sns_topic.digests.arn
  protocol  = "email"
  endpoint  = each.value
}

# --- the sealer ----------------------------------------------------------------------------------

locals {
  sealer_name = "${var.name}-spine-sealer"
}

resource "aws_cloudwatch_log_group" "sealer" {
  name              = "/aws/lambda/${local.sealer_name}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_iam_role" "sealer" {
  name = local.sealer_name
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

# Read the archive, write parts and manifests, never delete; publish digests; write its own log.
resource "aws_iam_role_policy" "sealer" {
  name = "sealer"
  role = aws_iam_role.sealer.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.archive.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "${aws_s3_bucket.archive.arn}/${local.prefix_glob}"
      },
      {
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = aws_sns_topic.digests.arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.sealer.arn}:*"
      },
    ]
  })
}

resource "aws_lambda_function" "sealer" {
  function_name    = local.sealer_name
  role             = aws_iam_role.sealer.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = var.sealer_package
  source_code_hash = filebase64sha256(var.sealer_package)
  timeout          = var.sealer_timeout_seconds
  memory_size      = var.sealer_memory_mb
  tags             = local.tags

  environment {
    variables = {
      ARCHIVE_BUCKET   = aws_s3_bucket.archive.bucket
      ARCHIVE_PREFIX   = var.archive_prefix
      DIGEST_TOPIC_ARN = aws_sns_topic.digests.arn
    }
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.sealer.name
  }

  depends_on = [aws_iam_role_policy.sealer]
}

resource "aws_iam_role" "scheduler" {
  name = "${local.sealer_name}-schedule"
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

resource "aws_iam_role_policy" "scheduler" {
  name = "invoke-sealer"
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = aws_lambda_function.sealer.arn
    }]
  })
}

resource "aws_scheduler_schedule" "sealer" {
  name                         = local.sealer_name
  schedule_expression          = var.sealer_schedule
  schedule_expression_timezone = "UTC"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.sealer.arn
    role_arn = aws_iam_role.scheduler.arn
    retry_policy {
      maximum_retry_attempts       = 2
      maximum_event_age_in_seconds = 3600
    }
  }
}

# The sealer failed.
resource "aws_cloudwatch_metric_alarm" "sealer_errors" {
  alarm_name          = "${local.sealer_name}-errors"
  alarm_description   = "The spine's sealer errored; a day is not sealed."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.sealer.function_name }
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_actions
  ok_actions          = var.alarm_actions
  tags                = local.tags
}

# The sealer did not run. Silence is the failure a component cannot report about itself.
resource "aws_cloudwatch_metric_alarm" "sealer_silent" {
  alarm_name          = "${local.sealer_name}-silent"
  alarm_description   = "The spine's sealer has not run in a day."
  namespace           = "AWS/Lambda"
  metric_name         = "Invocations"
  dimensions          = { FunctionName = aws_lambda_function.sealer.function_name }
  statistic           = "Sum"
  period              = 86400
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = var.alarm_actions
  ok_actions          = var.alarm_actions
  tags                = local.tags
}

# --- policies for the components' relays and for readers ------------------------------------------

locals {
  prefix_glob = var.archive_prefix == "" ? "*" : "${trimsuffix(var.archive_prefix, "/")}/*"

  relay_policy = {
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.archive.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = "${aws_s3_bucket.archive.arn}/${local.prefix_glob}"
      },
      {
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = aws_sns_topic.events.arn
      },
    ]
  }

  reader_policy = {
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.archive.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.archive.arn}/${local.prefix_glob}"
      },
    ]
  }
}
