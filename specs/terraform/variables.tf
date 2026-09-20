variable "name" {
  description = "Prefix for every named resource: <name>-api, <name>-relay, their roles, schedule and alarms."
  type        = string
  default     = "maestro-specs"
}

variable "api_package" {
  description = "Path to the API's zip, produced by `npm run bundle` in api/ (bundle/api.zip): the server as one file plus `run.sh`, which the Web Adapter runs as the handler."
  type        = string
}

variable "relay_package" {
  description = "Path to the relay's zip, produced by `npm run bundle` in api/ (bundle/relay.zip)."
  type        = string
}

variable "web_adapter_layer_arn" {
  description = "The AWS Lambda Web Adapter layer for the region and for arm64 (`LambdaAdapterLayerArm64`), published by AWS under its own account — which is why it is an input and not a default: https://github.com/awslabs/aws-lambda-web-adapter#lambda-functions-packaged-as-zip-package-for-aws-managed-runtimes."
  type        = string
  validation {
    condition     = can(regex("^arn:aws:lambda:[a-z0-9-]+:[^:]+:layer:LambdaAdapterLayerArm64:[0-9]+$", var.web_adapter_layer_arn))
    error_message = "web_adapter_layer_arn is the LambdaAdapterLayerArm64 layer ARN for the region: arn:aws:lambda:<region>:<aws-account-id>:layer:LambdaAdapterLayerArm64:<version>."
  }
}

variable "bucket_name" {
  description = "The service's own object store — attachments and payloads (ADR-0020). Globally unique, the tenant's to choose; the tenant's tfvars hold it. Versioned and encrypted, never Object-Locked: a payload must be erasable."
  type        = string
}

variable "environment" {
  description = "Configuration the service reads from its environment (api/src/config.ts is the schema): AUTH_MODE and its AUTH_* URLs, MONGO_CONTROL_DB, MONGO_DB_PREFIX, CORS_ORIGINS, MCP_RESOURCE_URL, EVALUATOR_BASE, LOG_LEVEL, … Anything secret — MONGO_URI, MONGO_PASSWORD — goes through `secrets` instead. The module sets what it owns on top: the port, the bucket, RECORD_SINK=off on the API and the archive on the relay."
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Environment variable name → Secrets Manager secret ARN, e.g. { MONGO_URI = aws_secretsmanager_secret.mongo_uri.arn }. The module reads each secret's current value and sets the variable on both functions. The value then sits in Terraform state — which ADR-0017 keeps in an encrypted, private bucket with an encrypted mirror; acceptable for M1. The follow-up is the Secrets Manager Lambda extension, which reads at runtime and keeps state free of values."
  type        = map(string)
  default     = {}
}

variable "archive" {
  description = "The spine's archive, as its module outputs it: `relay_environment` (ARCHIVE_BUCKET, ARCHIVE_PREFIX, EVENTS_TOPIC_ARN — the names the spine's relay handler reads) and `relay_policy_json` (what the relay's role may do: read and write the archive prefix, publish to the events topic, never delete). Pass module.spine.relay_environment and module.spine.relay_policy_json."
  type = object({
    relay_environment = map(string)
    relay_policy_json = string
  })
  validation {
    condition     = alltrue([for k in ["ARCHIVE_BUCKET", "ARCHIVE_PREFIX", "EVENTS_TOPIC_ARN"] : contains(keys(var.archive.relay_environment), k)])
    error_message = "archive.relay_environment carries ARCHIVE_BUCKET, ARCHIVE_PREFIX and EVENTS_TOPIC_ARN — the spine module's relay_environment output."
  }
}

variable "relay_schedule" {
  description = "EventBridge Scheduler expression for the relay, which drains the outbox into the archive. One minute is the latency between an act and its record."
  type        = string
  default     = "rate(1 minute)"
}

variable "api_memory_mb" {
  type    = number
  default = 1024
}

variable "api_timeout_seconds" {
  description = "The API function's timeout. HTTP API Gateway waits at most 30 seconds for an integration, so this is capped at 29: a request the gateway has already abandoned should not keep running."
  type        = number
  default     = 29
  validation {
    condition     = var.api_timeout_seconds >= 1 && var.api_timeout_seconds <= 29
    error_message = "api_timeout_seconds is between 1 and 29 — API Gateway's ceiling."
  }
}

variable "relay_memory_mb" {
  type    = number
  default = 512
}

variable "relay_timeout_seconds" {
  type    = number
  default = 300
}

variable "log_retention_days" {
  type    = number
  default = 90
}

variable "alarm_actions" {
  description = "ARNs notified when the relay errors or falls silent, or the API returns 5xx — the tenant's ops-signals topic, once work-service listens to it."
  type        = list(string)
  default     = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
