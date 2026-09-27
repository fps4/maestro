variable "name" {
  description = "Prefix for every named resource: <name> for the function and the API, e.g. fps4-console."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,40}$", var.name))
    error_message = "name is lower-case letters, digits and dashes, at most 41 characters."
  }
}

variable "package" {
  description = "The console's zip: `npm run build && npm run bundle` in console/web writes bundle/console.zip — Next's standalone server, its static files and run.sh."
  type        = string
}

variable "web_adapter_layer_arn" {
  description = "The AWS Lambda Web Adapter layer for the region and for arm64 (`LambdaAdapterLayerArm64`), published by AWS under its own account."
  type        = string
  validation {
    condition     = can(regex("^arn:aws:lambda:[a-z0-9-]+:[^:]+:layer:LambdaAdapterLayerArm64:[0-9]+$", var.web_adapter_layer_arn))
    error_message = "web_adapter_layer_arn is the LambdaAdapterLayerArm64 layer ARN for the region."
  }
}

variable "environment" {
  description = <<-EOT
    What the console's server reads at request time: the APIs it calls (API_PROXY_TARGET for specs-service,
    WORK_API_PROXY_TARGET for work-service), switches.
    NEXT_PUBLIC_* values are not read here — Next bakes them in at the build (the tenant pipeline's
    build_env). The module sets what it owns on top: the adapter, the port, NODE_ENV.
  EOT
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Environment variable → Secrets Manager secret ARN, read at plan and set on the function. The value is then in the state, which the state bucket protects (ADR-0017)."
  type        = map(string)
  default     = {}
}

variable "domain" {
  description = "The console's own host name, e.g. maestro.<tenant-domain>. With `certificate_arn`, the API answers on it: the edge in front (Cloudflare) points a CNAME at `domain_target`. Without it the console answers on the API's execute-api name only."
  type        = string
  default     = null
}

variable "certificate_arn" {
  description = "An ACM certificate for `domain`, ISSUED, in the deployment's own region (a regional API's custom domain). Validated by a DNS record the tenant adds where its zone is."
  type        = string
  default     = null
  validation {
    condition     = (var.certificate_arn == null) == (var.domain == null)
    error_message = "domain and certificate_arn are given together or not at all."
  }
}

variable "memory_mb" {
  description = "Memory for the function. A Next server renders in a few hundred MB; 1024 keeps cold starts short."
  type        = number
  default     = 1024
}

variable "timeout_seconds" {
  description = "Timeout for the function. An HTTP API waits at most 30 seconds for its integration."
  type        = number
  default     = 29
  validation {
    condition     = var.timeout_seconds >= 3 && var.timeout_seconds <= 30
    error_message = "timeout_seconds is between 3 and 30: the HTTP API's integration timeout is 30 seconds."
  }
}

variable "log_retention_days" {
  type    = number
  default = 90
}

variable "alarm_actions" {
  description = "ARNs notified when the console returns server errors."
  type        = list(string)
  default     = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
