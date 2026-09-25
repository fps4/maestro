variable "name" {
  description = "Prefix for every named resource: <name>-api, <name>-relay, <name>-sweep, their roles, schedules and alarms."
  type        = string
  default     = "maestro-work"
}

variable "api_package" {
  description = "Path to the API's zip, produced by `npm run bundle` in api/ (bundle/api.zip): the server as one file plus `run.sh`, which the Web Adapter runs as the handler."
  type        = string
}

variable "relay_package" {
  description = "Path to the relay's zip, produced by `npm run bundle` in api/ (bundle/relay.zip)."
  type        = string
}

variable "sweep_package" {
  description = "Path to the sweep's zip, produced by `npm run bundle` in api/ (bundle/sweep.zip)."
  type        = string
}

variable "sweep_principal" {
  description = "The workload principal the sweep acts as — identity-service's id for this service (prn-w-…). Every act the sweep records names it as `acting`; the item's accountable human stays `accountable`. The registry records it on the sweep's first run."
  type        = string
  validation {
    condition     = can(regex("^prn-w-[a-z0-9][a-z0-9._-]{0,62}$", var.sweep_principal))
    error_message = "sweep_principal is a workload principal id: prn-w-…"
  }
}

variable "sweep_schedule" {
  description = "EventBridge Scheduler expression for the sweep. A clock is late by at most this much (maestro ADR-0019 §6)."
  type        = string
  default     = "rate(1 minute)"
}

variable "sweep_memory_mb" {
  type    = number
  default = 512
}

variable "sweep_timeout_seconds" {
  type    = number
  default = 120
}

variable "web_adapter_layer_arn" {
  description = "The AWS Lambda Web Adapter layer for the region and for arm64 (`LambdaAdapterLayerArm64`), published by AWS under its own account — which is why it is an input and not a default: https://github.com/awslabs/aws-lambda-web-adapter#lambda-functions-packaged-as-zip-package-for-aws-managed-runtimes."
  type        = string
  validation {
    condition     = can(regex("^arn:aws:lambda:[a-z0-9-]+:[^:]+:layer:LambdaAdapterLayerArm64:[0-9]+$", var.web_adapter_layer_arn))
    error_message = "web_adapter_layer_arn is the LambdaAdapterLayerArm64 layer ARN for the region: arn:aws:lambda:<region>:<aws-account-id>:layer:LambdaAdapterLayerArm64:<version>."
  }
}

variable "table_name" {
  description = "The service's record store, one DynamoDB table (maestro ADR-0018): its name. Defaults to `name`. Unique in the account and region; a rename is a `moved` block, never a new table."
  type        = string
  default     = null
}

variable "bucket_name" {
  description = "The service's payload store — an item's title, a note, a reason. Globally unique, the tenant's to choose; the tenant's tfvars hold it. Versioned and encrypted, never Object-Locked: a payload must be erasable."
  type        = string
}

variable "environment" {
  description = "Configuration the service reads from its environment (api/src/config.ts is the schema): AUTH_MODE and its AUTH_* URLs, CORS_ORIGINS, MCP_RESOURCE_URL, LOG_LEVEL, … Anything secret goes through `secrets` instead. The module sets what it owns on top: the table, the port, the bucket, RECORD_SINK=off on the API and the archive on the relay. No database credential exists: the table is reached by the function's role."
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Environment variable name → Secrets Manager secret ARN, e.g. { SLACK_WEBHOOK_URL = aws_secretsmanager_secret.slack.arn } once a notifier adapter reads one. The module reads each secret's current value and sets the variable on both functions. The value then sits in Terraform state — which ADR-0017 keeps in an encrypted, private bucket with an encrypted mirror; acceptable for M1. The follow-up is the Secrets Manager Lambda extension, which reads at runtime and keeps state free of values. The record store needs none of this: no database credential exists (maestro ADR-0018)."
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

variable "archive_prefix" {
  description = "Where this component's relay writes inside the spine's archive, overriding the spine module's ARCHIVE_PREFIX. The spine's sequence is per workspace and per writer: two components whose workspaces share a slug must not relay into the same prefix, or the second one's `seq 1` is refused as a duplicate. Null keeps the spine's prefix. A prefix set here needs a sealer that seals it."
  type        = string
  default     = null
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
