# The distribution: one origin per function URL, one for the bucket, the path patterns the build
# lists, the custom domain when there is one.
#
# The edge holds the hashed assets for a year and nothing the server says: the server's cache
# policy has every TTL at zero. Next marks prerendered pages `s-maxage=31536000`, and an edge that
# honoured it would keep serving the previous build's page — pointing at chunks the deploy removed
# — until someone invalidated it. A console has tens of users; caching its HTML buys nothing, and a
# deploy that is complete when apply is buys a lot. Compression stays on.

locals {
  server_origin_domain = regex("^https://([^/]+)", aws_lambda_function_url.server.function_url)[0]
  images_origin_domain = var.image_optimization ? regex("^https://([^/]+)", aws_lambda_function_url.images[0].function_url)[0] : null

  origin_ids = {
    default        = "server"
    s3             = "assets"
    imageOptimizer = "images"
  }
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

resource "aws_cloudfront_origin_access_control" "server" {
  name                              = "${var.name}-server"
  description                       = "${var.name}: CloudFront to the server function URL"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# What reaches the server and keys nothing: every query string and cookie, the headers Next routes
# on. All of it is forwarded; none of it is held.
resource "aws_cloudfront_cache_policy" "server" {
  name        = "${var.name}-server"
  comment     = "${var.name}: forward everything the Next.js server reads; cache nothing"
  min_ttl     = 0
  default_ttl = 0
  max_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "all"
    }
    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["accept", "rsc", "next-router-prefetch", "next-router-state-tree", "next-url", "x-prerender-revalidate"]
      }
    }
    query_strings_config {
      query_string_behavior = "all"
    }
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
  }
}

# Optimised images are keyed by what they are asked for — url, w, q — and the formats accepted.
resource "aws_cloudfront_cache_policy" "images" {
  count       = var.image_optimization ? 1 : 0
  name        = "${var.name}-images"
  comment     = "${var.name}: optimised images by query string and accept"
  min_ttl     = 0
  default_ttl = 86400
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "whitelist"
      headers {
        items = ["accept"]
      }
    }
    query_strings_config {
      query_string_behavior = "all"
    }
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
  }
}

resource "aws_cloudfront_distribution" "this" {
  enabled         = true
  comment         = var.name
  is_ipv6_enabled = true
  http_version    = "http2and3"
  price_class     = var.price_class
  aliases         = var.domain == null ? [] : [var.domain]
  tags            = local.tags

  origin {
    origin_id                = local.origin_ids.default
    domain_name              = local.server_origin_domain
    origin_access_control_id = aws_cloudfront_origin_access_control.server.id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = max(var.timeout_seconds, 30)
    }
  }

  origin {
    origin_id                = local.origin_ids.s3
    domain_name              = aws_s3_bucket.assets.bucket_regional_domain_name
    origin_path              = "/${local.origin_path}"
    origin_access_control_id = aws_cloudfront_origin_access_control.assets.id
  }

  dynamic "origin" {
    for_each = var.image_optimization ? [1] : []
    content {
      origin_id                = local.origin_ids.imageOptimizer
      domain_name              = local.images_origin_domain
      origin_access_control_id = aws_cloudfront_origin_access_control.server.id

      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "https-only"
        origin_ssl_protocols   = ["TLSv1.2"]
        origin_read_timeout    = 30
      }
    }
  }

  # `*`: the server.
  default_cache_behavior {
    target_origin_id         = local.origin_ids.default
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = aws_cloudfront_cache_policy.server.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.forward_host.arn
    }

    lambda_function_association {
      event_type   = "origin-request"
      lambda_arn   = aws_lambda_function.signer.qualified_arn
      include_body = true
    }
  }

  # The build's other patterns, in its order. Assets are read-only and held as S3 says; a pattern
  # that names the server is the default behaviour under another path.
  dynamic "ordered_cache_behavior" {
    for_each = local.ordered_behaviors
    content {
      path_pattern             = ordered_cache_behavior.value.pattern
      target_origin_id         = local.origin_ids[ordered_cache_behavior.value.origin]
      viewer_protocol_policy   = "redirect-to-https"
      allowed_methods          = ordered_cache_behavior.value.origin == "default" ? ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"] : ["GET", "HEAD", "OPTIONS"]
      cached_methods           = ["GET", "HEAD"]
      compress                 = ordered_cache_behavior.value.origin != "imageOptimizer"
      cache_policy_id          = ordered_cache_behavior.value.origin == "s3" ? data.aws_cloudfront_cache_policy.caching_optimized.id : (ordered_cache_behavior.value.origin == "default" ? aws_cloudfront_cache_policy.server.id : aws_cloudfront_cache_policy.images[0].id)
      origin_request_policy_id = ordered_cache_behavior.value.origin == "default" ? data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id : null

      dynamic "function_association" {
        for_each = ordered_cache_behavior.value.origin == "default" ? [1] : []
        content {
          event_type   = "viewer-request"
          function_arn = aws_cloudfront_function.forward_host.arn
        }
      }

      dynamic "lambda_function_association" {
        for_each = ordered_cache_behavior.value.origin == "default" ? [1] : []
        content {
          event_type   = "origin-request"
          lambda_arn   = aws_lambda_function.signer.qualified_arn
          include_body = true
        }
      }
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # The tenant's certificate for its domain, else CloudFront's own for *.cloudfront.net — where
  # TLSv1 is the only minimum the API accepts, and the edge negotiates upwards regardless.
  viewer_certificate {
    cloudfront_default_certificate = var.domain == null
    acm_certificate_arn            = var.domain == null ? null : var.certificate_arn
    ssl_support_method             = var.domain == null ? null : "sni-only"
    minimum_protocol_version       = var.domain == null ? "TLSv1" : "TLSv1.2_2021"
  }

  lifecycle {
    precondition {
      condition     = var.domain == null || var.certificate_arn != null
      error_message = "A domain needs certificate_arn: an ACM certificate for it in us-east-1."
    }
  }
}
