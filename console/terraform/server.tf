# The server function: OpenNext's `server-functions/default` — the Next.js server, its middleware
# and its routes — as one Lambda behind a function URL that only CloudFront may call. Buffered,
# as the build says (`streaming: false`); a build made with the streaming wrapper is honoured.

locals {
  server_name = "${var.name}-server"
  images_name = "${var.name}-images"

  secret_values = { for key, version in data.aws_secretsmanager_secret_version.secret : key => version.secret_string }

  # Precedence: the tenant's environment, then the secrets. The server reads nothing from the
  # module: no cache bucket, no queue, no table — see the check in main.tf.
  server_environment = merge(var.environment, local.secret_values)
}

data "aws_secretsmanager_secret_version" "secret" {
  for_each  = var.secrets
  secret_id = each.value
}

# The function's package is the directory the build wrote, zipped here: entries sorted, timestamps
# fixed, so the same tree gives the same bytes and the same hash on any machine — a plan on a
# runner agrees with a plan on a laptop. Bundling stays OpenNext's; this is packaging for Lambda.
data "archive_file" "server" {
  type        = "zip"
  source_dir  = local.server_bundle
  output_path = "${path.module}/bundle/${local.server_name}.zip"
}

resource "aws_cloudwatch_log_group" "server" {
  name              = "/aws/lambda/${local.server_name}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_iam_role" "server" {
  name = local.server_name
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

# Logs only. The console talks to its component's API over HTTPS; it holds nothing in AWS.
resource "aws_iam_role_policy" "server" {
  name = "server"
  role = aws_iam_role.server.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "${aws_cloudwatch_log_group.server.arn}:*"
    }]
  })
}

resource "aws_lambda_function" "server" {
  function_name    = local.server_name
  description      = "${var.name}: the Next.js server (OpenNext)"
  role             = aws_iam_role.server.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = local.server.handler
  filename         = data.archive_file.server.output_path
  source_code_hash = data.archive_file.server.output_base64sha256
  timeout          = var.timeout_seconds
  memory_size      = var.memory_mb
  tags             = local.tags

  environment {
    variables = local.server_environment
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.server.name
  }

  depends_on = [aws_iam_role_policy.server]
}

resource "aws_lambda_function_url" "server" {
  function_name      = aws_lambda_function.server.function_name
  authorization_type = "AWS_IAM"
  invoke_mode        = try(local.server.streaming, false) ? "RESPONSE_STREAM" : "BUFFERED"
}

# CloudFront, on behalf of this distribution, is the one caller. Both grants the OAC documentation
# names: the URL, and the function behind it.
resource "aws_lambda_permission" "server_url" {
  statement_id           = "AllowCloudFrontServicePrincipal"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.server.function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.this.arn
  function_url_auth_type = "AWS_IAM"
}

resource "aws_lambda_permission" "server_invoke" {
  statement_id  = "AllowCloudFrontServicePrincipalInvokeFunction"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.server.function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = aws_cloudfront_distribution.this.arn
}

# The console is erroring: five failed renders in five minutes.
resource "aws_cloudwatch_metric_alarm" "server_errors" {
  alarm_name          = "${local.server_name}-errors"
  alarm_description   = "${var.name}'s server function is erroring."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = aws_lambda_function.server.function_name }
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

# --- the image optimiser, on request ---------------------------------------------------------------
# OpenNext's `image-optimization-function`: sharp on arm64, reading the source image from the
# assets bucket. A console that renders no `next/image` has no use for the 30 MB it weighs.

data "archive_file" "images" {
  count       = var.image_optimization ? 1 : 0
  type        = "zip"
  source_dir  = local.images_bundle
  output_path = "${path.module}/bundle/${local.images_name}.zip"

  lifecycle {
    precondition {
      condition     = local.images != null
      error_message = "image_optimization = true, but open-next.output.json lists no imageOptimizer origin: the build has no image optimisation function."
    }
  }
}

resource "aws_cloudwatch_log_group" "images" {
  count             = var.image_optimization ? 1 : 0
  name              = "/aws/lambda/${local.images_name}"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}

resource "aws_iam_role" "images" {
  count = var.image_optimization ? 1 : 0
  name  = local.images_name
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

resource "aws_iam_role_policy" "images" {
  count = var.image_optimization ? 1 : 0
  name  = "images"
  role  = aws_iam_role.images[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.assets.arn}/${local.origin_path}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.images[0].arn}:*"
      },
    ]
  })
}

resource "aws_lambda_function" "images" {
  count            = var.image_optimization ? 1 : 0
  function_name    = local.images_name
  description      = "${var.name}: image optimisation (OpenNext, sharp)"
  role             = aws_iam_role.images[0].arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = local.images.handler
  filename         = data.archive_file.images[0].output_path
  source_code_hash = data.archive_file.images[0].output_base64sha256
  timeout          = 25
  memory_size      = 1536
  tags             = local.tags

  environment {
    variables = {
      BUCKET_NAME       = aws_s3_bucket.assets.bucket
      BUCKET_KEY_PREFIX = local.origin_path
    }
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.images[0].name
  }

  depends_on = [aws_iam_role_policy.images]
}

resource "aws_lambda_function_url" "images" {
  count              = var.image_optimization ? 1 : 0
  function_name      = aws_lambda_function.images[0].function_name
  authorization_type = "AWS_IAM"
  invoke_mode        = "BUFFERED"
}

resource "aws_lambda_permission" "images_url" {
  count                  = var.image_optimization ? 1 : 0
  statement_id           = "AllowCloudFrontServicePrincipal"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.images[0].function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.this.arn
  function_url_auth_type = "AWS_IAM"
}

resource "aws_lambda_permission" "images_invoke" {
  count         = var.image_optimization ? 1 : 0
  statement_id  = "AllowCloudFrontServicePrincipalInvokeFunction"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.images[0].function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = aws_cloudfront_distribution.this.arn
}
