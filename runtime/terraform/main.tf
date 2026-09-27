# runtime-service on AWS (maestro ADR-0011, ADR-0018, ADR-0027): the table holding the artifact
# ledger and the instance register, the bucket the pipelines upload their SBOMs to, the API behind an
# HTTP API Gateway through the Lambda Web Adapter, the relay that drains the outbox into the spine's
# archive on a schedule, and the intake that takes `maestro.build` and `maestro.deploy` off the
# account's default bus. The spine's own module owns the archive and the topic; this one composes with
# its outputs. A tenant's root calls both (ADR-0017).

locals {
  tags        = merge({ "maestro:component" = "runtime-service" }, var.tags)
  api_name    = "${var.name}-api"
  relay_name  = "${var.name}-relay"
  intake_name = "${var.name}-intake"
  intake_on   = var.intake != null
  table_name  = coalesce(var.table_name, var.name)

  # Each secret's current value, by the environment variable name it is set as.
  secret_env = { for name, secret in data.aws_secretsmanager_secret_version.secret : name => secret.secret_string }

  # What a deployment is unless the tenant says otherwise. NODE_ENV=production makes config.ts refuse
  # AUTH_MODE=dev — no identity provider is no authentication, not a degraded mode.
  environment_defaults = {
    NODE_ENV = "production"
  }

  # What the module owns and a tenant's `environment` cannot override: the table the module made
  # (the function's role is the grant; there is no credential to pass).
  table_environment = {
    TABLE_NAME = aws_dynamodb_table.records.name
  }
  # The SBOM store, named to every function that loads the service's config: the API and the intake
  # read the SBOM a build record names; the relay never does, but its config is the same config, and
  # under RECORD_SINK=off the SBOM store defaults to `s3` and refuses to load without a bucket.
  # Naming it is not granting it — the relay's role has no S3 action.
  store_environment = {
    SBOM_STORE          = "s3"
    SBOM_BUCKET         = aws_s3_bucket.store.bucket
    S3_BUCKET           = aws_s3_bucket.store.bucket
    S3_REGION           = aws_s3_bucket.store.region
    S3_FORCE_PATH_STYLE = "false"
  }
  # Where a digest mismatch goes (ADR-0027 §5). Both the API's intake route and the intake function
  # record deploys, so both carry it; the client's secret comes through `secrets`.
  signals_environment = var.signals == null ? { SIGNALS = "log" } : {
    SIGNALS           = "work"
    WORK_API_URL      = var.signals.work_api_url
    SIGNALS_TOKEN_URL = var.signals.token_url
    SIGNALS_CLIENT_ID = var.signals.client_id
  }
  api_environment = merge(local.table_environment, local.store_environment, local.signals_environment, {
    AWS_LAMBDA_EXEC_WRAPPER      = "/opt/bootstrap"
    AWS_LWA_READINESS_CHECK_PATH = "/health"
    AWS_LWA_ASYNC_INIT           = "true" # describe the table past Lambda's 10 s init budget if need be
    PORT                         = "8080"
    HOST                         = "0.0.0.0"
    RECORD_SINK                  = "off"
  })

  # What each function may do to the table: the item operations the service sends, on the table and
  # its indexes, and nothing that alters the table itself. No Scan: every read is a key or an index,
  # and a rebuild's drop of a workspace's prefix is an operator's act under the operator's own grant.
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
  # What a function may read of the bucket: the SBOMs, and nothing it could write. A pipeline puts
  # them, under the grant the tenant gives its role (README.md).
  sbom_objects = "${aws_s3_bucket.store.arn}/sbom/*"
}

data "aws_secretsmanager_secret_version" "secret" {
  for_each  = var.secrets
  secret_id = each.value
}

# --- the record store: one table ------------------------------------------------------------------

# The service's record (maestro ADR-0018, ADR-0027 §1): one table keyed pk/sk, a workspace's items
# under `ws#<workspace>#`, control items under `ctl#`; `gsi1` the ledger by build and the estate,
# `gsi2` kept for the shared shape, the sparse `pending` index the relay reads; TTL on `expires_at`
# for the idempotency cache. api/src/db/table.ts declares the same table for
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

# --- the SBOM store ---------------------------------------------------------------------------------

# The CycloneDX files the pipelines upload under `sbom/<application>/<digest>.cdx.json` before they
# put `maestro.build` (ADR-0027 §2). Versioned and encrypted, never public. The bucket is the
# tenant's data; a refactor moves it with a `moved` block, nothing replaces it.
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

# Its own log, its own table, and a read of the SBOMs its intake route names — nothing else. The
# archive is the relay's.
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
        Action   = ["s3:GetObject"]
        Resource = local.sbom_objects
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
  alarm_description   = "runtime-service's API is returning server errors."
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
  name = "invoke-relay"
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = [aws_lambda_function.relay.arn]
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
  alarm_description   = "runtime-service's relay errored; events stay pending in the outbox."
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
  alarm_description   = "runtime-service's relay has not run in fifteen minutes."
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
  alarm_description   = "The spine refused an event from runtime-service; that workspace's relay is stopped until a person looks."
  namespace           = "maestro/spine"
  metric_name         = "Refused"
  dimensions          = { function = "relay", component = "runtime" }
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

# --- the intake ------------------------------------------------------------------------------------
# Build records and deploys (ADR-0027 §3): a rule on the account's default bus delivers the
# pipelines' `maestro.build` and `maestro.deploy` into this service's own queue, beside
# work-service's rule for the same deploys, and the intake function records each as the intake
# workload. A record that fails is retried by SQS, alone, until the dead-letter queue takes it — and
# that is an alarm.

resource "aws_sqs_queue" "intake_dlq" {
  count                     = local.intake_on ? 1 : 0
  name                      = "${local.intake_name}-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
  tags                      = local.tags
}

resource "aws_sqs_queue" "intake" {
  count                      = local.intake_on ? 1 : 0
  name                       = local.intake_name
  visibility_timeout_seconds = 6 * var.intake_timeout_seconds
  message_retention_seconds  = 345600
  sqs_managed_sse_enabled    = true
  redrive_policy             = jsonencode({ deadLetterTargetArn = aws_sqs_queue.intake_dlq[0].arn, maxReceiveCount = 5 })
  tags                       = local.tags
}

resource "aws_cloudwatch_event_rule" "intake" {
  count         = local.intake_on ? 1 : 0
  name          = local.intake_name
  description   = "Build records and deploys an application's pipeline puts, for runtime-service's ledger and register."
  event_pattern = jsonencode({ source = var.intake.sources })
  tags          = local.tags
}

resource "aws_cloudwatch_event_target" "intake" {
  count = local.intake_on ? 1 : 0
  rule  = aws_cloudwatch_event_rule.intake[0].name
  arn   = aws_sqs_queue.intake[0].arn
}

# Who may send: the rule, and nothing else.
resource "aws_sqs_queue_policy" "intake" {
  count     = local.intake_on ? 1 : 0
  queue_url = aws_sqs_queue.intake[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "IntakeRule"
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = aws_sqs_queue.intake[0].arn
      Condition = { ArnEquals = { "aws:SourceArn" = aws_cloudwatch_event_rule.intake[0].arn } }
    }]
  })
}

resource "aws_cloudwatch_log_group" "intake" {
  count             = local.intake_on ? 1 : 0
  name              = "/aws/lambda/${local.intake_name}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_iam_role" "intake" {
  count = local.intake_on ? 1 : 0
  name  = local.intake_name
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

# Its own log, the table, a read of the SBOMs, its queue — nothing else.
resource "aws_iam_role_policy" "intake" {
  count = local.intake_on ? 1 : 0
  name  = "intake"
  role  = aws_iam_role.intake[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.intake[0].arn}:*"
      },
      {
        Effect   = "Allow"
        Action   = local.table_actions
        Resource = local.table_resources
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = local.sbom_objects
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = aws_sqs_queue.intake[0].arn
      },
    ]
  })
}

resource "aws_lambda_function" "intake" {
  count            = local.intake_on ? 1 : 0
  function_name    = local.intake_name
  role             = aws_iam_role.intake[0].arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = var.intake_package
  source_code_hash = filebase64sha256(var.intake_package)
  timeout          = var.intake_timeout_seconds
  memory_size      = var.intake_memory_mb
  tags             = local.tags

  environment {
    variables = merge(local.environment_defaults, var.environment, local.secret_env, local.table_environment, local.store_environment, local.signals_environment, {
      RECORD_SINK      = "off"
      INTAKE_PRINCIPAL = var.intake.principal
      INTAKE_WORKSPACE = var.intake.workspace
    })
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.intake[0].name
  }

  depends_on = [aws_iam_role_policy.intake]
}

resource "aws_lambda_event_source_mapping" "intake" {
  count                   = local.intake_on ? 1 : 0
  event_source_arn        = aws_sqs_queue.intake[0].arn
  function_name           = aws_lambda_function.intake[0].arn
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}

# A build record or a deploy nobody could take in: it waits in the dead-letter queue for a person.
resource "aws_cloudwatch_metric_alarm" "intake_dead_letters" {
  count               = local.intake_on ? 1 : 0
  alarm_name          = "${local.intake_name}-dead-letters"
  alarm_description   = "Build records or deploys runtime-service could not take in, five tries each; they wait in ${local.intake_name}-dlq."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  dimensions          = { QueueName = aws_sqs_queue.intake_dlq[0].name }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = var.alarm_actions
  ok_actions          = var.alarm_actions
  tags                = local.tags
}

resource "aws_cloudwatch_metric_alarm" "intake_errors" {
  count               = local.intake_on ? 1 : 0
  alarm_name          = "${local.intake_name}-errors"
  alarm_description   = "runtime-service's intake errored; the records are retried and may reach the dead-letter queue."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.intake[0].function_name }
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
