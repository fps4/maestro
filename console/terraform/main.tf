# The console (maestro ADR-0023, ADR-0026): Next's standalone server on Lambda behind the Web Adapter,
# an HTTP API in front of it, and the tenant's host name on that API. The edge — TLS to the browser,
# caching the hashed static files, whatever protection the tenant wants — is the tenant's CDN
# (Cloudflare), not this module. The same shape as every maestro API.

locals {
  tags       = merge(var.tags, { "maestro:console" = var.name })
  secret_env = { for name, s in data.aws_secretsmanager_secret_version.secret : name => s.secret_string }

  # What the module owns and `environment` cannot override: the adapter wraps the runtime and
  # proxies each event to PORT, where run.sh starts `node server.js`; Next's standalone server
  # listens on PORT and HOSTNAME.
  owned_environment = {
    AWS_LAMBDA_EXEC_WRAPPER      = "/opt/bootstrap"
    AWS_LWA_READINESS_CHECK_PATH = "/sign-in"
    PORT                         = "8080"
    HOSTNAME                     = "127.0.0.1"
    NODE_ENV                     = "production"
  }
}

data "aws_secretsmanager_secret_version" "secret" {
  for_each  = var.secrets
  secret_id = each.value
}

# --- the function ------------------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "console" {
  name              = "/aws/lambda/${var.name}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_iam_role" "console" {
  name = var.name
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

# Its own log, and nothing else: the console holds no data; it reads the APIs with the person's token.
resource "aws_iam_role_policy" "console" {
  name = "console"
  role = aws_iam_role.console.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "${aws_cloudwatch_log_group.console.arn}:*"
    }]
  })
}

resource "aws_lambda_function" "console" {
  function_name    = var.name
  role             = aws_iam_role.console.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "run.sh"
  layers           = [var.web_adapter_layer_arn]
  filename         = var.package
  source_code_hash = filebase64sha256(var.package)
  memory_size      = var.memory_mb
  timeout          = var.timeout_seconds

  environment {
    variables = merge(var.environment, local.secret_env, local.owned_environment)
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.console.name
  }

  tags       = local.tags
  depends_on = [aws_iam_role_policy.console]
}

# --- the API in front of it --------------------------------------------------------------------------

resource "aws_apigatewayv2_api" "console" {
  name          = var.name
  protocol_type = "HTTP"
  # The tenant's host name is the only way in once it is set; the execute-api name stays for checks.
  tags = local.tags
}

resource "aws_apigatewayv2_integration" "console" {
  api_id                 = aws_apigatewayv2_api.console.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.console.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = var.timeout_seconds * 1000
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.console.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.console.id}"
}

resource "aws_cloudwatch_log_group" "gateway" {
  name              = "/aws/apigateway/${var.name}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.console.id
  name        = "$default"
  auto_deploy = true
  tags        = local.tags

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.gateway.arn
    format = jsonencode({
      requestId        = "$context.requestId"
      requestTime      = "$context.requestTime"
      httpMethod       = "$context.httpMethod"
      path             = "$context.path"
      status           = "$context.status"
      responseLength   = "$context.responseLength"
      integrationError = "$context.integrationErrorMessage"
    })
  }
}

resource "aws_lambda_permission" "gateway" {
  statement_id  = "AllowHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.console.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.console.execution_arn}/*/*"
}

# --- the tenant's host name ----------------------------------------------------------------------------

resource "aws_apigatewayv2_domain_name" "console" {
  count       = var.domain == null ? 0 : 1
  domain_name = var.domain
  domain_name_configuration {
    certificate_arn = var.certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
  tags = local.tags
}

resource "aws_apigatewayv2_api_mapping" "console" {
  count       = var.domain == null ? 0 : 1
  api_id      = aws_apigatewayv2_api.console.id
  domain_name = aws_apigatewayv2_domain_name.console[0].id
  stage       = aws_apigatewayv2_stage.default.id
}

# --- when it fails -----------------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "console_5xx" {
  alarm_name          = "${var.name}-5xx"
  alarm_description   = "The console is returning server errors."
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  dimensions          = { ApiId = aws_apigatewayv2_api.console.id, Stage = aws_apigatewayv2_stage.default.name }
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
