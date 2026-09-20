output "topic_arn" {
  description = "The ops-signals topic: <application>-<environment>-ops-signals. What maestro subscribes to; what the tenant's applications/*.yaml records."
  value       = aws_sns_topic.ops_signals.arn
}

output "tags" {
  description = "The tag schema — maestro:application, maestro:environment, maestro:tier — merged over the tags passed in. Spread onto the application's own resources so every signal identifies its instance."
  value       = local.tags
}

output "alarm_actions" {
  description = "Put on an aws_cloudwatch_metric_alarm's alarm_actions. The alarm-action helper for Terraform: the topic, as a list."
  value       = [aws_sns_topic.ops_signals.arn]
}

output "ok_actions" {
  description = "Put on the same alarm's ok_actions. An OK on the same fingerprint is what closes or downgrades the item (docs/signals.md); an alarm without it never lets go."
  value       = [aws_sns_topic.ops_signals.arn]
}

output "heartbeat_metric" {
  description = "Where the heartbeat lands — namespace, name, dimensions — for an application that wants its own view of it. null when heartbeat is off."
  value = var.heartbeat ? {
    namespace  = local.heartbeat_namespace
    name       = local.heartbeat_metric
    dimensions = local.heartbeat_dimensions
  } : null
}
