output "url" {
  description = "Where the console answers: https://<domain> when one was given, else the distribution's own name."
  value       = "https://${var.domain == null ? aws_cloudfront_distribution.this.domain_name : var.domain}"
}

output "distribution_id" {
  value = aws_cloudfront_distribution.this.id
}

output "distribution_domain_name" {
  description = "The *.cloudfront.net name. The root's DNS points `domain` at it: a Route 53 alias to it and `distribution_hosted_zone_id`, or a CNAME elsewhere."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "distribution_hosted_zone_id" {
  description = "CloudFront's hosted zone id, for a Route 53 alias record."
  value       = aws_cloudfront_distribution.this.hosted_zone_id
}

output "assets_bucket_name" {
  value = aws_s3_bucket.assets.bucket
}

output "server_function_name" {
  value = aws_lambda_function.server.function_name
}

output "images_function_name" {
  description = "The image optimisation function, when image_optimization is on; null otherwise."
  value       = var.image_optimization ? aws_lambda_function.images[0].function_name : null
}
