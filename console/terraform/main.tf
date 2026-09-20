# A Next.js console on AWS (ADR-0002, ADR-0016): OpenNext's build output as one Lambda function
# behind CloudFront, its static assets in S3. The module reads `open-next.output.json` — what
# OpenNext says it built — and deploys what a console needs from it: the server function and the
# assets, the image optimiser on request. The rest of what OpenNext can build (ISR's revalidation
# queue and tag cache, the warmer) is not deployed: the consoles have none of it. See README.md.
#
#   viewer ──▶ CloudFront ──▶ _next/*, public files ──▶ S3 (assets, OAC)
#                        └──▶ everything else ──▶ Lambda function URL (server, OAC + edge signer)
#                        └──▶ _next/image* ──▶ Lambda function URL (images, OAC)   [optional]

data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}

locals {
  tags = merge({ "maestro:console" = var.name }, var.tags)

  # What OpenNext built. Paths in the file are relative to the console's directory
  # (".open-next/assets"); the module is given `.open-next/` itself.
  output = jsondecode(file("${var.open_next_dir}/open-next.output.json"))

  server = local.output.origins.default
  images = try(local.output.origins.imageOptimizer, null)
  s3     = local.output.origins.s3

  server_bundle = "${var.open_next_dir}/${trimprefix(local.server.bundle, ".open-next/")}"
  images_bundle = local.images == null ? null : "${var.open_next_dir}/${trimprefix(local.images.bundle, ".open-next/")}"

  # The bucket prefix CloudFront's S3 origin points at ("_assets"). Only what is copied under it
  # is uploaded: the `_cache` copy an ISR build lists is the incremental cache's, and the module
  # deploys no incremental cache.
  origin_path = local.s3.originPath
  copies      = [for c in local.s3.copy : c if startswith(c.to, local.origin_path)]

  # Every file under every copied directory, keyed by its bucket key. The versioned subdirectory
  # (`_next`, content-hashed by Next) is immutable; everything else — the console's `public/` —
  # keeps its name across builds and is revalidated on every request.
  assets = merge([
    for c in local.copies : {
      for f in fileset("${var.open_next_dir}/${trimprefix(c.from, ".open-next/")}", "**") :
      "${c.to}/${f}" => {
        source    = "${var.open_next_dir}/${trimprefix(c.from, ".open-next/")}/${f}"
        immutable = try(startswith(f, "${c.versionedSubDir}/"), false)
        extension = try(lower(regex("\\.([^./]+)$", f)[0]), "")
      }
    }
  ]...)

  content_types = {
    html        = "text/html; charset=utf-8"
    htm         = "text/html; charset=utf-8"
    js          = "text/javascript; charset=utf-8"
    mjs         = "text/javascript; charset=utf-8"
    css         = "text/css; charset=utf-8"
    json        = "application/json"
    map         = "application/json"
    txt         = "text/plain; charset=utf-8"
    xml         = "application/xml"
    svg         = "image/svg+xml"
    png         = "image/png"
    jpg         = "image/jpeg"
    jpeg        = "image/jpeg"
    gif         = "image/gif"
    webp        = "image/webp"
    avif        = "image/avif"
    ico         = "image/x-icon"
    woff        = "font/woff"
    woff2       = "font/woff2"
    ttf         = "font/ttf"
    otf         = "font/otf"
    wasm        = "application/wasm"
    pdf         = "application/pdf"
    webmanifest = "application/manifest+json"
    mp4         = "video/mp4"
    webm        = "video/webm"
  }

  # CloudFront's path patterns, from the file, in the file's order: the first match wins, so
  # `_next/data/*` (server) precedes `_next/*` (assets). `*` is the default behaviour. The image
  # optimiser's pattern is kept only when its function is deployed; without it `_next/image*` falls
  # through to the assets origin and 404s, which is what a console without `next/image` wants.
  ordered_behaviors = [
    for b in local.output.behaviors : b
    if b.pattern != "*" && (b.origin != "imageOptimizer" || var.image_optimization)
  ]
}

# The build was made for a server with no cache behind it, or it was not. A default build expects
# an S3 incremental cache, a DynamoDB tag cache and an SQS revalidation queue; none is created
# here. Such a console still serves, and logs a failed cache lookup on every prerendered page.
check "built_for_ssr" {
  assert {
    condition     = try(local.output.additionalProps.disableIncrementalCache, false) && try(local.output.additionalProps.disableTagCache, false)
    error_message = "open-next.output.json says the build expects an incremental cache and a tag cache; this module creates neither. Build the console with dangerous.disableIncrementalCache and dangerous.disableTagCache in open-next.config.ts (console/README.md)."
  }
}

# --- the assets ----------------------------------------------------------------------------------

resource "aws_s3_bucket" "assets" {
  bucket = var.assets_bucket_name
  tags   = local.tags
}

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "assets" {
  bucket = aws_s3_bucket.assets.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# CloudFront reads, on behalf of this distribution only; ListBucket so a missing asset is a 404
# and not a 403. Nobody else, and nothing over plaintext.
resource "aws_s3_bucket_policy" "assets" {
  bucket = aws_s3_bucket.assets.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "CloudFrontReads"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = ["s3:GetObject", "s3:ListBucket"]
        Resource  = [aws_s3_bucket.assets.arn, "${aws_s3_bucket.assets.arn}/*"]
        Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.this.arn } }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.assets.arn, "${aws_s3_bucket.assets.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
    ]
  })
  depends_on = [aws_s3_bucket_public_access_block.assets]
}

# One object per file, inside plan and apply: a new build shows as the objects it adds, changes and
# removes. The previous build's hashed chunks go with it; a browser holding the old page reloads on
# its next navigation, which Next does itself when a chunk is gone.
resource "aws_s3_object" "asset" {
  for_each = local.assets

  bucket        = aws_s3_bucket.assets.id
  key           = each.key
  source        = each.value.source
  etag          = filemd5(each.value.source)
  content_type  = lookup(local.content_types, each.value.extension, "application/octet-stream")
  cache_control = each.value.immutable ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate"
}

resource "aws_cloudfront_origin_access_control" "assets" {
  name                              = "${var.name}-assets"
  description                       = "${var.name}: CloudFront to the assets bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}
