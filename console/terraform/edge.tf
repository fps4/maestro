# Two small functions at the edge, both on every path that reaches the server:
#
# - a CloudFront Function on the viewer request that copies the Host header into
#   x-forwarded-host, because CloudFront rewrites Host when it calls a function URL;
# - a Lambda@Edge function on the origin request that hashes the request body into
#   x-amz-content-sha256, because origin access control signs the request but not its body, and
#   Lambda refuses an unsigned POST. Without it the console's form posts and server actions 403.
#
# Lambda@Edge lives in us-east-1 (hence the aws.us_east_1 configuration), is x86_64, carries no
# environment, and is referenced by a published version. It writes its logs in the region that ran
# it, under /aws/lambda/us-east-1.<name>, which is why its role may create log groups.

locals {
  signer_name = "${var.name}-signer"
}

resource "aws_cloudfront_function" "forward_host" {
  name    = "${var.name}-forward-host"
  comment = "${var.name}: Host → x-forwarded-host for the Next.js server"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/edge/forward-host.js")
}

data "archive_file" "signer" {
  type        = "zip"
  output_path = "${path.module}/bundle/${local.signer_name}.zip"
  source {
    content  = file("${path.module}/edge/signer.js")
    filename = "index.js"
  }
}

resource "aws_iam_role" "signer" {
  name = local.signer_name
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = ["lambda.amazonaws.com", "edgelambda.amazonaws.com"] }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy" "signer" {
  name = "signer"
  role = aws_iam_role.signer.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = [
        "arn:${data.aws_partition.current.partition}:logs:*:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/us-east-1.${local.signer_name}",
        "arn:${data.aws_partition.current.partition}:logs:*:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/us-east-1.${local.signer_name}:*",
      ]
    }]
  })
}

resource "aws_lambda_function" "signer" {
  provider = aws.us_east_1

  function_name    = local.signer_name
  description      = "${var.name}: hashes request bodies for CloudFront's signed calls to the server (Lambda@Edge)"
  role             = aws_iam_role.signer.arn
  runtime          = "nodejs22.x"
  architectures    = ["x86_64"]
  handler          = "index.handler"
  filename         = data.archive_file.signer.output_path
  source_code_hash = data.archive_file.signer.output_base64sha256
  timeout          = 5
  memory_size      = 128
  publish          = true
  tags             = local.tags

  depends_on = [aws_iam_role_policy.signer]
}
