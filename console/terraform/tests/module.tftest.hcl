# Module tests with a mocked provider: no account, no credentials. What they check is the shape
# the design promises — every file under the build's assets uploaded with the right cache-control,
# the server on Node 22 behind a function URL only CloudFront may call, the path patterns the build
# lists, the edge functions on every server path, a domain only when one is given, the image
# optimiser only on request — not whether AWS accepts it. That is proven by the first real tenant
# (ADR-0017).

# Terraform >= 1.11 (override_during). ARNs are mocked without an account: the public-repository
# guards forbid one, and the policies only need the shape. Two configurations, as the root passes
# them: the deployment's region and us-east-1 for the Lambda@Edge signer.
mock_provider "aws" {
  mock_data "aws_partition" {
    defaults = {
      partition = "aws"
    }
  }
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "this-account"
    }
  }
  mock_data "aws_cloudfront_cache_policy" {
    defaults = {
      id = "managed-caching-optimized"
    }
  }
  mock_data "aws_cloudfront_origin_request_policy" {
    defaults = {
      id = "managed-all-viewer-except-host"
    }
  }
  mock_data "aws_secretsmanager_secret_version" {
    defaults = {
      secret_string = "the-secret-value"
    }
  }
  mock_resource "aws_s3_bucket" {
    override_during = plan
    defaults = {
      arn                         = "arn:aws:s3:::aannemer-x-specs-console-assets"
      bucket_regional_domain_name = "aannemer-x-specs-console-assets.s3.eu-west-1.amazonaws.com"
    }
  }
  mock_resource "aws_cloudwatch_log_group" {
    override_during = plan
    defaults = {
      arn = "arn:aws:logs:eu-west-1::log-group:/aws/lambda/example"
    }
  }
  mock_resource "aws_iam_role" {
    override_during = plan
    defaults = {
      arn = "arn:aws:iam:::role/example"
    }
  }
  mock_resource "aws_lambda_function" {
    override_during = plan
    defaults = {
      arn           = "arn:aws:lambda:eu-west-1::function:example"
      qualified_arn = "arn:aws:lambda:eu-west-1::function:example:1"
    }
  }
  mock_resource "aws_lambda_function_url" {
    override_during = plan
    defaults = {
      function_url = "https://example.lambda-url.eu-west-1.on.aws/"
      url_id       = "example"
    }
  }
  mock_resource "aws_cloudfront_function" {
    override_during = plan
    defaults = {
      arn = "arn:aws:cloudfront:::function/example"
    }
  }
  mock_resource "aws_cloudfront_distribution" {
    override_during = plan
    defaults = {
      arn            = "arn:aws:cloudfront:::distribution/EXAMPLE"
      domain_name    = "example.cloudfront.net"
      hosted_zone_id = "Z2FDTNDATAQYW2"
    }
  }
}

mock_provider "aws" {
  alias = "us_east_1"
  mock_resource "aws_lambda_function" {
    override_during = plan
    defaults = {
      arn           = "arn:aws:lambda:us-east-1::function:example-signer"
      qualified_arn = "arn:aws:lambda:us-east-1::function:example-signer:1"
    }
  }
}

variables {
  name               = "specs-console"
  open_next_dir      = "./tests/fixtures/open-next"
  assets_bucket_name = "aannemer-x-specs-console-assets"
  environment        = { API_PROXY_TARGET = "https://specs-api.aannemer-x.example" }
  secrets            = { SESSION_SECRET = "arn:aws:secretsmanager:eu-west-1::secret:aannemer-x/specs-console/session" }
}

run "defaults" {
  command = plan

  # the assets
  assert {
    condition     = length(aws_s3_object.asset) == 4
    error_message = "every file under the build's assets is an object: BUILD_ID, favicon.ico and two hashed files"
  }
  assert {
    condition     = aws_s3_object.asset["_assets/_next/static/chunks/app-0123abcd.js"].cache_control == "public, max-age=31536000, immutable"
    error_message = "the versioned subdirectory is immutable for a year"
  }
  assert {
    condition     = aws_s3_object.asset["_assets/favicon.ico"].cache_control == "public, max-age=0, must-revalidate" && aws_s3_object.asset["_assets/BUILD_ID"].cache_control == "public, max-age=0, must-revalidate"
    error_message = "public files keep their names across builds and are revalidated on every request"
  }
  assert {
    condition = (
      aws_s3_object.asset["_assets/_next/static/chunks/app-0123abcd.js"].content_type == "text/javascript; charset=utf-8" &&
      aws_s3_object.asset["_assets/_next/static/css/app-0123abcd.css"].content_type == "text/css; charset=utf-8" &&
      aws_s3_object.asset["_assets/favicon.ico"].content_type == "image/x-icon" &&
      aws_s3_object.asset["_assets/BUILD_ID"].content_type == "application/octet-stream"
    )
    error_message = "content types come from the extension; a file without one is an octet stream"
  }
  assert {
    condition     = alltrue([for o in aws_s3_object.asset : startswith(o.key, "_assets/")])
    error_message = "objects land under the origin path the build names"
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.assets.block_public_acls && aws_s3_bucket_public_access_block.assets.restrict_public_buckets
    error_message = "the assets bucket is never public: CloudFront reads it through an origin access control"
  }
  assert {
    condition     = aws_s3_bucket_versioning.assets.versioning_configuration[0].status == "Enabled"
    error_message = "the assets bucket is versioned"
  }
  assert {
    condition     = strcontains(aws_s3_bucket_policy.assets.policy, "cloudfront.amazonaws.com") && strcontains(aws_s3_bucket_policy.assets.policy, "arn:aws:cloudfront:::distribution/EXAMPLE") && !strcontains(aws_s3_bucket_policy.assets.policy, "Put") && !strcontains(aws_s3_bucket_policy.assets.policy, "Delete")
    error_message = "the bucket policy admits CloudFront on behalf of this distribution, to read"
  }

  # the origin access controls
  assert {
    condition     = aws_cloudfront_origin_access_control.assets.origin_access_control_origin_type == "s3" && aws_cloudfront_origin_access_control.assets.signing_behavior == "always"
    error_message = "an OAC of type s3 signs every request to the bucket"
  }
  assert {
    condition     = aws_cloudfront_origin_access_control.server.origin_access_control_origin_type == "lambda" && aws_cloudfront_origin_access_control.server.signing_behavior == "always" && aws_cloudfront_origin_access_control.server.signing_protocol == "sigv4"
    error_message = "an OAC of type lambda signs every request to the function URL"
  }

  # the server
  assert {
    condition     = aws_lambda_function.server.runtime == "nodejs22.x" && aws_lambda_function.server.architectures == tolist(["arm64"]) && aws_lambda_function.server.handler == "index.handler"
    error_message = "the server runs OpenNext's bundle on Node 22, arm64, with the handler the build names"
  }
  assert {
    condition     = aws_lambda_function.server.memory_size == 1024 && aws_lambda_function.server.timeout == 10
    error_message = "1024 MB and ten seconds by default"
  }
  assert {
    condition     = aws_lambda_function.server.environment[0].variables["API_PROXY_TARGET"] == "https://specs-api.aannemer-x.example" && aws_lambda_function.server.environment[0].variables["SESSION_SECRET"] == "the-secret-value"
    error_message = "the environment carries the tenant's variables and the secrets' values"
  }
  assert {
    condition     = !contains(keys(aws_lambda_function.server.environment[0].variables), "CACHE_BUCKET_NAME") && !contains(keys(aws_lambda_function.server.environment[0].variables), "REVALIDATION_QUEUE_URL")
    error_message = "the server is told of no cache and no queue: none is deployed"
  }
  assert {
    condition     = aws_lambda_function_url.server.authorization_type == "AWS_IAM" && aws_lambda_function_url.server.invoke_mode == "BUFFERED"
    error_message = "the function URL takes signed calls only, buffered as the build says"
  }
  assert {
    condition     = aws_lambda_permission.server_url.principal == "cloudfront.amazonaws.com" && aws_lambda_permission.server_url.action == "lambda:InvokeFunctionUrl" && aws_lambda_permission.server_url.source_arn == "arn:aws:cloudfront:::distribution/EXAMPLE"
    error_message = "CloudFront may call the URL on behalf of this distribution, and nobody else may"
  }
  assert {
    condition     = !strcontains(aws_iam_role_policy.server.policy, "s3:") && !strcontains(aws_iam_role_policy.server.policy, "sqs:") && !strcontains(aws_iam_role_policy.server.policy, "dynamodb:")
    error_message = "the server's role writes logs and nothing else"
  }
  assert {
    condition     = aws_cloudwatch_log_group.server.retention_in_days == 90
    error_message = "logs are kept ninety days by default"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.server_errors.threshold == 5 && aws_cloudwatch_metric_alarm.server_errors.period == 300 && aws_cloudwatch_metric_alarm.server_errors.treat_missing_data == "notBreaching"
    error_message = "five errors in five minutes is the alarm; a quiet console is not"
  }

  # the distribution
  assert {
    condition     = aws_cloudfront_distribution.this.default_cache_behavior[0].viewer_protocol_policy == "redirect-to-https" && alltrue([for b in aws_cloudfront_distribution.this.ordered_cache_behavior : b.viewer_protocol_policy == "redirect-to-https"])
    error_message = "every behaviour redirects to HTTPS"
  }
  assert {
    condition     = aws_cloudfront_distribution.this.http_version == "http2and3" && aws_cloudfront_distribution.this.is_ipv6_enabled && aws_cloudfront_distribution.this.price_class == "PriceClass_100"
    error_message = "HTTP/2 and /3, IPv6, and the tenant's price class"
  }
  assert {
    condition     = toset([for o in aws_cloudfront_distribution.this.origin : o.origin_id]) == toset(["server", "assets"])
    error_message = "two origins by default: the server and the assets"
  }
  assert {
    condition     = [for b in aws_cloudfront_distribution.this.ordered_cache_behavior : b.path_pattern] == ["_next/data/*", "favicon.ico", "BUILD_ID", "_next/*"]
    error_message = "the build's path patterns, in the build's order, minus the default and the image optimiser's"
  }
  assert {
    condition     = { for b in aws_cloudfront_distribution.this.ordered_cache_behavior : b.path_pattern => b.target_origin_id } == { "_next/data/*" = "server", "favicon.ico" = "assets", "BUILD_ID" = "assets", "_next/*" = "assets" }
    error_message = "each pattern reaches the origin the build names"
  }
  assert {
    condition     = aws_cloudfront_distribution.this.default_cache_behavior[0].target_origin_id == "server" && contains(aws_cloudfront_distribution.this.default_cache_behavior[0].allowed_methods, "POST")
    error_message = "the default behaviour is the server, and it takes posts"
  }
  assert {
    condition     = aws_cloudfront_cache_policy.server.max_ttl == 0 && aws_cloudfront_cache_policy.server.parameters_in_cache_key_and_forwarded_to_origin[0].cookies_config[0].cookie_behavior == "all" && aws_cloudfront_cache_policy.server.parameters_in_cache_key_and_forwarded_to_origin[0].query_strings_config[0].query_string_behavior == "all"
    error_message = "the server's responses are never held at the edge; every cookie and query string is forwarded"
  }
  assert {
    condition     = contains(aws_cloudfront_cache_policy.server.parameters_in_cache_key_and_forwarded_to_origin[0].headers_config[0].headers[0].items, "rsc") && contains(aws_cloudfront_cache_policy.server.parameters_in_cache_key_and_forwarded_to_origin[0].headers_config[0].headers[0].items, "next-router-state-tree")
    error_message = "the headers Next routes on reach the server"
  }
  assert {
    condition     = length(aws_cloudfront_distribution.this.default_cache_behavior[0].function_association) == 1 && length(aws_cloudfront_distribution.this.default_cache_behavior[0].lambda_function_association) == 1 && tolist(aws_cloudfront_distribution.this.default_cache_behavior[0].lambda_function_association)[0].include_body == true
    error_message = "the server's path carries the host-forwarding function and the body-signing function, with the body"
  }
  assert {
    condition     = alltrue([for b in aws_cloudfront_distribution.this.ordered_cache_behavior : length(b.lambda_function_association) == (b.target_origin_id == "server" ? 1 : 0)])
    error_message = "the signer is on every server path and on no asset path"
  }
  assert {
    condition     = length(aws_cloudfront_distribution.this.aliases) == 0 && aws_cloudfront_distribution.this.viewer_certificate[0].cloudfront_default_certificate == true
    error_message = "no domain, no alias: the distribution's own name and certificate"
  }
  assert {
    condition     = output.url == "https://example.cloudfront.net"
    error_message = "the url is the distribution's name when no domain is given"
  }

  # the edge
  assert {
    condition     = aws_lambda_function.signer.publish == true && aws_lambda_function.signer.architectures == tolist(["x86_64"]) && length(aws_lambda_function.signer.environment) == 0
    error_message = "the signer is a published version on x86_64 with no environment, as Lambda@Edge requires"
  }
  assert {
    condition     = strcontains(aws_iam_role.signer.assume_role_policy, "edgelambda.amazonaws.com")
    error_message = "the signer's role trusts the edge service principal"
  }
  assert {
    condition     = aws_cloudfront_function.forward_host.runtime == "cloudfront-js-2.0" && strcontains(aws_cloudfront_function.forward_host.code, "x-forwarded-host")
    error_message = "the viewer-request function sets x-forwarded-host"
  }

  # what is not there
  assert {
    condition     = length(aws_lambda_function.images) == 0 && length(aws_cloudfront_cache_policy.images) == 0
    error_message = "no image optimisation function by default"
  }
  assert {
    condition     = output.images_function_name == null
    error_message = "and no name to output for it"
  }
}

run "with_a_domain" {
  command = plan

  variables {
    domain          = "specs.aannemer-x.example"
    certificate_arn = "arn:aws:acm:us-east-1::certificate/example"
  }

  assert {
    condition     = aws_cloudfront_distribution.this.aliases == toset(["specs.aannemer-x.example"])
    error_message = "the domain is the distribution's alias"
  }
  assert {
    condition     = aws_cloudfront_distribution.this.viewer_certificate[0].acm_certificate_arn == "arn:aws:acm:us-east-1::certificate/example" && aws_cloudfront_distribution.this.viewer_certificate[0].ssl_support_method == "sni-only" && aws_cloudfront_distribution.this.viewer_certificate[0].minimum_protocol_version == "TLSv1.2_2021"
    error_message = "the tenant's certificate, SNI, TLS 1.2 at least"
  }
  assert {
    condition     = output.url == "https://specs.aannemer-x.example"
    error_message = "the url is the domain"
  }
}

run "with_image_optimization" {
  command = plan

  variables {
    image_optimization = true
  }

  assert {
    condition     = length(aws_lambda_function.images) == 1 && aws_lambda_function.images[0].architectures == tolist(["arm64"]) && aws_lambda_function.images[0].handler == "index.handler"
    error_message = "the image optimiser is deployed from the build's bundle, on arm64 as OpenNext builds sharp"
  }
  assert {
    condition     = aws_lambda_function.images[0].environment[0].variables["BUCKET_NAME"] == "aannemer-x-specs-console-assets" && aws_lambda_function.images[0].environment[0].variables["BUCKET_KEY_PREFIX"] == "_assets"
    error_message = "it reads source images from the assets bucket under the origin path"
  }
  assert {
    condition     = strcontains(aws_iam_role_policy.images[0].policy, "s3:GetObject") && strcontains(aws_iam_role_policy.images[0].policy, "/_assets/*")
    error_message = "and may read nothing else"
  }
  assert {
    condition     = contains([for o in aws_cloudfront_distribution.this.origin : o.origin_id], "images") && [for b in aws_cloudfront_distribution.this.ordered_cache_behavior : b.path_pattern][0] == "_next/image*"
    error_message = "a third origin, and the build's image pattern first"
  }
  assert {
    condition     = output.images_function_name == "specs-console-images"
    error_message = "the function's name is output"
  }
}

run "warns_on_a_build_that_expects_a_cache" {
  command = plan

  variables {
    open_next_dir = "./tests/fixtures/open-next-isr"
  }

  expect_failures = [check.built_for_ssr]

  assert {
    condition     = length(aws_s3_object.asset) == 2 && !anytrue([for o in aws_s3_object.asset : startswith(o.key, "_cache/")])
    error_message = "the assets are uploaded and the incremental cache's copy is not"
  }
  assert {
    condition     = aws_lambda_function.server.handler == "index.handler"
    error_message = "the server is deployed regardless: a default build serves, with a warning"
  }
}

run "rejects_a_domain_without_a_certificate" {
  command = plan

  variables {
    domain = "specs.aannemer-x.example"
  }

  expect_failures = [aws_cloudfront_distribution.this]
}

run "rejects_a_certificate_outside_us_east_1" {
  command = plan

  variables {
    domain          = "specs.aannemer-x.example"
    certificate_arn = "arn:aws:acm:eu-west-1::certificate/example"
  }

  expect_failures = [var.certificate_arn]
}

run "rejects_an_unknown_price_class" {
  command = plan

  variables {
    price_class = "PriceClass_50"
  }

  expect_failures = [var.price_class]
}

run "rejects_a_timeout_cloudfront_cannot_wait_for" {
  command = plan

  variables {
    timeout_seconds = 90
  }

  expect_failures = [var.timeout_seconds]
}
