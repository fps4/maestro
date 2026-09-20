output "archive_bucket_name" {
  value = aws_s3_bucket.archive.bucket
}

output "archive_bucket_arn" {
  value = aws_s3_bucket.archive.arn
}

output "archive_prefix" {
  value = var.archive_prefix
}

output "events_topic_arn" {
  description = "The FIFO topic relays publish to and consumers' FIFO queues subscribe to."
  value       = aws_sns_topic.events.arn
}

output "digests_topic_arn" {
  value = aws_sns_topic.digests.arn
}

output "sealer_function_name" {
  value = aws_lambda_function.sealer.function_name
}

output "relay_policy_json" {
  description = "Attach to a component's relay role: read and write the archive, publish to the events topic. Never delete."
  value       = jsonencode(local.relay_policy)
}

output "reader_policy_json" {
  description = "Attach to a verifier's or exporter's role: read the archive."
  value       = jsonencode(local.reader_policy)
}

output "relay_environment" {
  description = "What a relay Lambda's environment carries — the names the spine's handlers read."
  value = {
    ARCHIVE_BUCKET   = aws_s3_bucket.archive.bucket
    ARCHIVE_PREFIX   = var.archive_prefix
    EVENTS_TOPIC_ARN = aws_sns_topic.events.arn
  }
}
