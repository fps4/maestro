variable "name" {
  description = "Prefix for every named resource: <name>-api, <name>-relay, <name>-intake, their roles, schedules and alarms."
  type        = string
  default     = "maestro-runtime"
}

variable "api_package" {
  description = "Path to the API's zip, produced by `npm run bundle` in api/ (bundle/api.zip): the server as one file plus `run.sh`, which the Web Adapter runs as the handler."
  type        = string
}

variable "relay_package" {
  description = "Path to the relay's zip, produced by `npm run bundle` in api/ (bundle/relay.zip)."
  type        = string
}

variable "intake" {
  description = <<-EOT
    The intake (maestro ADR-0027 §3): build records and deploys from the applications' pipelines.
    Null: none — no queue, no rule, no intake function. Otherwise:
      principal  identity-service's workload id the intake acts as (prn-w-…), admitted to the
                 workspace in the `intake` seat
      workspace  where the build records and deploys land
      sources    EventBridge `source` values on this account's default bus it takes in
  EOT
  type = object({
    principal = string
    workspace = string
    sources   = optional(list(string), ["maestro.build", "maestro.deploy"])
  })
  default = null
  validation {
    condition     = var.intake == null || can(regex("^prn-w-[a-z0-9][a-z0-9._-]{0,62}$", var.intake.principal))
    error_message = "intake.principal is a workload principal id: prn-w-…"
  }
}

variable "intake_package" {
  description = "Path to the intake's zip (bundle/intake.zip), when `intake` is set."
  type        = string
  default     = null
}

variable "signals" {
  description = <<-EOT
    Where a digest mismatch goes (maestro ADR-0027 §5). Null: a log line only (SIGNALS=log).
    Otherwise work-service's signals intake, as this service's own workload:
      work_api_url  work-service's API (its module's api_url)
      token_url     identity-service's token endpoint (<issuer>/oauth2/token)
      client_id     the client-credentials client identity-service registered for this service
    The client's secret goes through `secrets` as SIGNALS_CLIENT_SECRET. The workload is admitted
    to work-service's workspace in the `intake` seat.
  EOT
  type = object({
    work_api_url = string
    token_url    = string
    client_id    = string
  })
  default = null
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
  description = "The service's bucket: the SBOMs the pipelines upload under `sbom/<application>/<digest>.cdx.json` (ADR-0027 §2). Globally unique, the tenant's to choose. Versioned and encrypted, never public."
  type        = string
}

variable "environment" {
  description = "Configuration the service reads from its environment (api/src/config.ts is the schema): AUTH_MODE and its AUTH_* URLs, CORS_ORIGINS, LOG_LEVEL, … Anything secret goes through `secrets` instead. The module sets what it owns on top: the table, the port, the bucket, RECORD_SINK=off on the API, the archive on the relay, the intake and the signals. No database credential exists: the table is reached by the function's role."
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Environment variable name → Secrets Manager secret ARN, e.g. { SIGNALS_CLIENT_SECRET = … } when `signals` is set. The module reads each secret's current value and sets the variable on every function. The value then sits in Terraform state, which ADR-0017 keeps in an encrypted, private bucket; the Secrets Manager Lambda extension replaces this before the GitHub App's key arrives."
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
  description = "Where this component's relay writes inside the spine's archive, overriding the spine module's ARCHIVE_PREFIX (e.g. `runtime/`). The spine's sequence is per workspace and per writer: two components whose workspaces share a slug must not relay into the same prefix. Null keeps the spine's prefix. A prefix set here needs a sealer that seals it."
  type        = string
  default     = null
}

variable "relay_schedule" {
  description = "EventBridge Scheduler expression for the relay, which drains the outbox into the archive. One minute is the latency between an act and its record — and between a level set here and work-service projecting it."
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

variable "intake_memory_mb" {
  type    = number
  default = 512
}

variable "intake_timeout_seconds" {
  type    = number
  default = 60
}

variable "log_retention_days" {
  type    = number
  default = 90
}

variable "alarm_actions" {
  description = "ARNs notified when the relay errors or falls silent, the intake fails, or the API returns 5xx."
  type        = list(string)
  default     = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
