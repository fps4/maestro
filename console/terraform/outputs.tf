output "url" {
  description = "Where the console answers: https://<domain> when one is set, else the API's execute-api name."
  value       = var.domain == null ? aws_apigatewayv2_api.console.api_endpoint : "https://${var.domain}"
}

output "api_endpoint" {
  description = "The API's own https://<id>.execute-api.<region>.amazonaws.com — for checks; the tenant's host name is the way in."
  value       = aws_apigatewayv2_api.console.api_endpoint
}

output "domain_target" {
  description = "Where the edge's CNAME for `domain` points (d-….execute-api.<region>.amazonaws.com); null without a domain."
  value       = var.domain == null ? null : aws_apigatewayv2_domain_name.console[0].domain_name_configuration[0].target_domain_name
}

output "domain_hosted_zone_id" {
  description = "The regional API's hosted zone, for a Route 53 alias instead of a CNAME; null without a domain."
  value       = var.domain == null ? null : aws_apigatewayv2_domain_name.console[0].domain_name_configuration[0].hosted_zone_id
}

output "function_name" {
  value = aws_lambda_function.console.function_name
}
