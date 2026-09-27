output "api_url" {
  description = "The API's base URL — the gateway's default endpoint. Put it in the console's configuration and in identity-service's registration of this service."
  value       = aws_apigatewayv2_api.api.api_endpoint
}

output "api_id" {
  description = "The HTTP API's id, for a custom domain mapping in the root."
  value       = aws_apigatewayv2_api.api.id
}

output "table_name" {
  description = "The record store: one table, the service's own. The operator's `workspace:apply` and `workspace:member` take it as TABLE_NAME."
  value       = aws_dynamodb_table.records.name
}

output "table_arn" {
  value = aws_dynamodb_table.records.arn
}

output "bucket_name" {
  description = "The SBOM store. A pipeline uploads its build's CycloneDX file to `sbom/<application>/<digest>.cdx.json` here, then puts `maestro.build` naming that key."
  value       = aws_s3_bucket.store.bucket
}

output "bucket_arn" {
  description = "For the tenant's grant to each application's pipeline role: `s3:PutObject` on `<bucket_arn>/sbom/<application>/*`, and nothing else."
  value       = aws_s3_bucket.store.arn
}

output "api_function_name" {
  value = aws_lambda_function.api.function_name
}

output "relay_function_name" {
  value = aws_lambda_function.relay.function_name
}

output "intake_function_name" {
  value = local.intake_on ? aws_lambda_function.intake[0].function_name : null
}

output "intake_queue_arn" {
  description = "The intake's queue, for a tenant that adds its own sources."
  value       = local.intake_on ? aws_sqs_queue.intake[0].arn : null
}
