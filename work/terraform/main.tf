# work-service on AWS (maestro ADR-0002, ADR-0016, ADR-0018, ADR-0019): the table, the payload
# store, the API behind an HTTP API Gateway through the Lambda Web Adapter, and the relay that
# drains the outbox into the spine's archive on a schedule. The spine's own module owns the archive
# and the topic; this one composes with its outputs. A tenant's root calls both (ADR-0017).

locals {
  tags       = merge({ "maestro:component" = "work-service" }, var.tags)
  api_name   = "${var.name}-api"
  relay_name = "${var.name}-relay"
  sweep_name = "${var.name}-sweep"
  table_name = coalesce(var.table_name, var.name)

  # Each secret's current value, by the environment variable name it is set as.
  secret_env = { for name, secret in data.aws_secretsmanager_secret_version.secret : name => secret.secret_string }

  # What a deployment is unless the tenant says otherwise. NODE_ENV=production makes config.ts refuse
  # AUTH_MODE=dev — no identity provider is no authentication, not a degraded mode.
  environment_defaults = {
    NODE_ENV = "production"
  }

  # What the module owns and a tenant's `environment` cannot override: the table the module made
  # (the function's role is the grant; there is no credential to pass), the port the adapter
  # proxies to, the bucket the module made, and RECORD_SINK=off — the API writes the outbox and
  # relays nothing; the relay function is the one relay. AWS_REGION is the runtime's.
  table_environment = {
    TABLE_NAME = aws_dynamodb_table.records.name
  }
  # The payload store, named to every function that loads the service's config: the API writes and
  # reads it; the relay never touches it, but its config is the same config, and under
  # RECORD_SINK=off the payload store defaults to `s3` and refuses to load without a bucket. Naming
  # it is not granting it — the relay's role has no S3 action.
  store_environment = {
    S3_BUCKET           = aws_s3_bucket.store.bucket
    S3_REGION           = aws_s3_bucket.store.region
    S3_FORCE_PATH_STYLE = "false"
    PAYLOAD_BUCKET      = aws_s3_bucket.store.bucket
  }
  api_environment = merge(local.table_environment, local.store_environment, {
    AWS_LAMBDA_EXEC_WRAPPER      = "/opt/bootstrap"
    AWS_LWA_READINESS_CHECK_PATH = "/health"
    AWS_LWA_ASYNC_INIT           = "true" # describe the table past Lambda's 10 s init budget if need be
    PORT                         = "8080"
    HOST                         = "0.0.0.0"
    RECORD_SINK                  = "off"
    SWEEP_MODE                   = "off" # the sweep function is the one sweep
  })

  # What each function may do to the table: the item operations the service sends, on the table
  # and its indexes, and nothing that alters the table itself. No Scan: every read the service
  # makes is a key or an index (maestro ADR-0019 §3), and a rebuild's drop of a workspace's prefix
  # is an operator's act under the operator's own grant, never a function's.
  # api/tests/unit/grant.test.ts reads this list and the code's commands and fails on a gap.
  table_actions = [
    "dynamodb:GetItem",
    "dynamodb:BatchGetItem",
    "dynamodb:PutItem",
    "dynamodb:UpdateItem",
    "dynamodb:DeleteItem",
    "dynamodb:Query",
    "dynamodb:BatchWriteItem",
    "dynamodb:TransactWriteItems",
    # A ConditionCheck inside a transaction is its own action, and DynamoDB Local never enforces
    # IAM: a grant without it passes every test and refuses on AWS.
    "dynamodb:ConditionCheckItem",
    "dynamodb:DescribeTable",
  ]
  table_resources = [aws_dynamodb_table.records.arn, "${aws_dynamodb_table.records.arn}/index/*"]
}

data "aws_secretsmanager_secret_version" "secret" {
  for_each  = var.secrets
  secret_id = each.value
}

# --- the record store: one table ------------------------------------------------------------------

# The service's record (maestro ADR-0018, ADR-0019): one table keyed pk/sk, a workspace's items
# under `ws#<workspace>#`, control items under `ctl#`; `gsi1` the open set by next clock and the
# closed by month, `gsi2` an application's items, the sparse `pending` index the relay reads; TTL
# on `expires_at` for the idempotency caches. api/src/db/table.ts declares the same table for
# DynamoDB Local and the tests, and the service checks the two agree at boot — a change here is a
# change there. On demand, so an idle tenant pays for bytes only; point-in-time recovery is the
# second line behind the archive. The table is the tenant's data: `prevent_destroy`, and a
# refactor moves it with a `moved` block.
resource "aws_dynamodb_table" "records" {
  name         = local.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"
  tags         = local.tags

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  attribute {
    name = "gsi1pk"
    type = "S"
  }
  attribute {
    name = "gsi1sk"
    type = "S"
  }
  attribute {
    name = "gsi2pk"
    type = "S"
  }
  attribute {
    name = "gsi2sk"
    type = "S"
  }
  attribute {
    name = "pending_pk"
    type = "S"
  }
  attribute {
    name = "pending_sk"
    type = "S"
  }

  global_secondary_index {
    name            = "gsi1"
    hash_key        = "gsi1pk"
    range_key       = "gsi1sk"
    projection_type = "ALL"
  }
  global_secondary_index {
    name            = "gsi2"
    hash_key        = "gsi2pk"
    range_key       = "gsi2sk"
    projection_type = "ALL"
  }
  global_secondary_index {
    name            = "pending"
    hash_key        = "pending_pk"
    range_key       = "pending_sk"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

# --- the payload store ------------------------------------------------------------------------------

# An item's title, a note, a reason: the words an event names by reference and digest. Versioned
# and encrypted, never public, never Object-Locked: the archive proves which bytes were recorded,
# and a payload lives here so that it can be erased. The bucket is the tenant's data; a refactor
# moves it with a `moved` block, nothing replaces it.
resource "aws_s3_bucket" "store" {
  bucket              = var.bucket_name
  object_lock_enabled = false
  tags                = local.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "store" {
  bucket = aws_s3_bucket.store.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "store" {
  bucket                  = aws_s3_bucket.store.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "store" {
  bucket = aws_s3_bucket.store.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "store" {
  bucket = aws_s3_bucket.store.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_policy" "store" {
  bucket = aws_s3_bucket.store.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.store.arn, "${aws_s3_bucket.store.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.store]
}

# --- the API ---------------------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.api_name}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_iam_role" "api" {
  name = local.api_name
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

# Its own log, its own table, its own bucket — payloads are put, read and erased — and nothing
# else. The archive is the relay's.
resource "aws_iam_role_policy" "api" {
  name = "api"
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.api.arn}:*"
      },
      {
        Effect   = "Allow"
        Action   = local.table_actions
        Resource = local.table_resources
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.store.arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.store.arn}/*"
      },
    ]
  })
}

# The Fastify server, unchanged, as a zip on the managed runtime: the Web Adapter layer is started
# by AWS_LAMBDA_EXEC_WRAPPER, proxies each event to PORT, and the handler is the script that starts
# the server — `run.sh`, which `npm run bundle` puts beside index.mjs.
resource "aws_lambda_function" "api" {
  function_name    = local.api_name
  role             = aws_iam_role.api.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "run.sh"
  layers           = [var.web_adapter_layer_arn]
  filename         = var.api_package
  source_code_hash = filebase64sha256(var.api_package)
  timeout          = var.api_timeout_seconds
  memory_size      = var.api_memory_mb
  tags             = local.tags

  environment {
    variables = merge(local.environment_defaults, var.environment, local.secret_env, local.api_environment)
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.api.name
  }

  depends_on = [aws_iam_role_policy.api]
}

# HTTP API Gateway, one route for everything, deployed as it changes. CORS is the application's
# (CORS_ORIGINS), not the gateway's, so the same code answers the same way behind any proxy.
resource "aws_apigatewayv2_api" "api" {
  name          = local.api_name
  protocol_type = "HTTP"
  tags          = local.tags
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.api.id}"
}

resource "aws_cloudwatch_log_group" "gateway" {
  name              = "/aws/apigateway/${local.api_name}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
  tags        = local.tags

  # One line per request from the gateway's side, so a 5xx the function never saw — a timeout, a
  # throttle — is still on record somewhere.
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.gateway.arn
    format = jsonencode({
      requestId        = "$context.requestId"
      requestTime      = "$context.requestTime"
      httpMethod       = "$context.httpMethod"
      path             = "$context.path"
      status           = "$context.status"
      responseLatency  = "$context.responseLatency"
      integrationError = "$context.integrationErrorMessage"
      sourceIp         = "$context.identity.sourceIp"
    })
  }
}

resource "aws_lambda_permission" "gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# The API answered 5xx — its own errors and the gateway's (a timeout, a throttle) alike.
resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${local.api_name}-5xx"
  alarm_description   = "work-service's API is returning server errors."
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  dimensions          = { ApiId = aws_apigatewayv2_api.api.id, Stage = aws_apigatewayv2_stage.default.name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_actions
  ok_actions          = var.alarm_actions
  tags                = local.tags
}

# --- the relay -------------------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "relay" {
  name              = "/aws/lambda/${local.relay_name}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_iam_role" "relay" {
  name = local.relay_name
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

# Its own log and the table — the outbox it drains and acks, the workspaces it lists, the
# principals it checks — and nothing else of its own. The archive is the spine's grant, below.
resource "aws_iam_role_policy" "relay_logs" {
  name = "logs"
  role = aws_iam_role.relay.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.relay.arn}:*"
      },
      {
        Effect   = "Allow"
        Action   = local.table_actions
        Resource = local.table_resources
      },
    ]
  })
}

# What the spine allows a relay: read and write the archive prefix, publish to the events topic,
# never delete. The spine's module wrote it; this one attaches it unchanged.
resource "aws_iam_role_policy" "relay_archive" {
  name   = "archive"
  role   = aws_iam_role.relay.id
  policy = var.archive.relay_policy_json
}

# The spine's relay handler over this service's outbox. One at a time: the outbox is drained in
# order, and a second invocation while one runs is throttled and retried by the schedule rather
# than run beside it.
resource "aws_lambda_function" "relay" {
  function_name                  = local.relay_name
  role                           = aws_iam_role.relay.arn
  runtime                        = "nodejs22.x"
  architectures                  = ["arm64"]
  handler                        = "index.handler"
  filename                       = var.relay_package
  source_code_hash               = filebase64sha256(var.relay_package)
  timeout                        = var.relay_timeout_seconds
  memory_size                    = var.relay_memory_mb
  reserved_concurrent_executions = 1
  tags                           = local.tags

  environment {
    variables = merge(local.environment_defaults, var.environment, local.secret_env, local.table_environment, local.store_environment, var.archive.relay_environment, var.archive_prefix == null ? {} : { ARCHIVE_PREFIX = var.archive_prefix })
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.relay.name
  }

  depends_on = [aws_iam_role_policy.relay_logs, aws_iam_role_policy.relay_archive]
}

resource "aws_iam_role" "scheduler" {
  name = "${local.relay_name}-schedule"
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
  name = "invoke-relay-and-sweep"
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = [aws_lambda_function.relay.arn, aws_lambda_function.sweep.arn]
    }]
  })
}

resource "aws_scheduler_schedule" "relay" {
  name                         = local.relay_name
  schedule_expression          = var.relay_schedule
  schedule_expression_timezone = "UTC"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.relay.arn
    role_arn = aws_iam_role.scheduler.arn
    retry_policy {
      maximum_retry_attempts       = 2
      maximum_event_age_in_seconds = 300
    }
  }
}

# The relay failed.
resource "aws_cloudwatch_metric_alarm" "relay_errors" {
  alarm_name          = "${local.relay_name}-errors"
  alarm_description   = "work-service's relay errored; events stay pending in the outbox."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.relay.function_name }
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

# The relay did not run. Silence is the failure a component cannot report about itself.
resource "aws_cloudwatch_metric_alarm" "relay_silent" {
  alarm_name          = "${local.relay_name}-silent"
  alarm_description   = "work-service's relay has not run in fifteen minutes."
  namespace           = "AWS/Lambda"
  metric_name         = "Invocations"
  dimensions          = { FunctionName = aws_lambda_function.relay.function_name }
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = var.alarm_actions
  ok_actions          = var.alarm_actions
  tags                = local.tags
}

# The spine refused an event. That workspace's relay stops where it stands, by design, until a
# person looks; the relay reports it as a metric in its log line (embedded metric format).
resource "aws_cloudwatch_metric_alarm" "relay_refused" {
  alarm_name          = "${local.relay_name}-refused"
  alarm_description   = "The spine refused an event from work-service; that workspace's relay is stopped until a person looks."
  namespace           = "maestro/spine"
  metric_name         = "Refused"
  dimensions          = { function = "relay", component = "work" }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_actions
  ok_actions          = var.alarm_actions
  tags                = local.tags
}

# --- the sweep -------------------------------------------------------------------------------------
# What the passing of time does to open items (maestro ADR-0019 §6): leases expire, ladder steps are
# delivered through the notifier and recorded, breaches are recorded, items past review close
# `expired`. It reads each workspace's open set up to now and writes each item on its revision, so it
# needs the table and nothing else — the notifier is an outbound HTTPS call, not a grant.

resource "aws_cloudwatch_log_group" "sweep" {
  name              = "/aws/lambda/${local.sweep_name}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_iam_role" "sweep" {
  name = local.sweep_name
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

# Its own log, the table, and the payload store: an item past review closes `expired` with a reason,
# and a reason is a payload.
resource "aws_iam_role_policy" "sweep" {
  name = "sweep"
  role = aws_iam_role.sweep.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.sweep.arn}:*"
      },
      {
        Effect   = "Allow"
        Action   = local.table_actions
        Resource = local.table_resources
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = "${aws_s3_bucket.store.arn}/*"
      },
    ]
  })
}

# One at a time, like the relay: two sweeps would race harmlessly on each item's revision, but the
# second would only re-decide what the first did.
resource "aws_lambda_function" "sweep" {
  function_name                  = local.sweep_name
  role                           = aws_iam_role.sweep.arn
  runtime                        = "nodejs22.x"
  architectures                  = ["arm64"]
  handler                        = "index.handler"
  filename                       = var.sweep_package
  source_code_hash               = filebase64sha256(var.sweep_package)
  timeout                        = var.sweep_timeout_seconds
  memory_size                    = var.sweep_memory_mb
  reserved_concurrent_executions = 1
  tags                           = local.tags

  environment {
    variables = merge(local.environment_defaults, var.environment, local.secret_env, local.table_environment, local.store_environment, {
      RECORD_SINK     = "off"
      SWEEP_MODE      = "off"
      SWEEP_PRINCIPAL = var.sweep_principal
    })
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.sweep.name
  }

  depends_on = [aws_iam_role_policy.sweep]
}

resource "aws_scheduler_schedule" "sweep" {
  name                         = local.sweep_name
  schedule_expression          = var.sweep_schedule
  schedule_expression_timezone = "UTC"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_lambda_function.sweep.arn
    role_arn = aws_iam_role.scheduler.arn
    retry_policy {
      # A missed minute is caught by the next: the sweep fires every step that is due, in order.
      maximum_retry_attempts       = 0
      maximum_event_age_in_seconds = 60
    }
  }
}

# The sweep failed — for the whole run, or for an item it will retry next minute.
resource "aws_cloudwatch_metric_alarm" "sweep_errors" {
  alarm_name          = "${local.sweep_name}-errors"
  alarm_description   = "work-service's sweep errored; due items stay due and are retried next minute."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.sweep.function_name }
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  threshold           = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_actions
  ok_actions          = var.alarm_actions
  tags                = local.tags
}

# The sweep did not run: no clock would chase, breach or expire anything.
resource "aws_cloudwatch_metric_alarm" "sweep_silent" {
  alarm_name          = "${local.sweep_name}-silent"
  alarm_description   = "work-service's sweep has not run in fifteen minutes; no clock is being kept."
  namespace           = "AWS/Lambda"
  metric_name         = "Invocations"
  dimensions          = { FunctionName = aws_lambda_function.sweep.function_name }
  statistic           = "Sum"
  period              = 900
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = var.alarm_actions
  ok_actions          = var.alarm_actions
  tags                = local.tags
}
