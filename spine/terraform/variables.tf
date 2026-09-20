variable "name" {
  description = "Prefix for every named resource: <name>-spine-events.fifo, <name>-spine-sealer, …"
  type        = string
  default     = "maestro"
}

variable "archive_bucket_name" {
  description = "The archive bucket. Globally unique, the tenant's to choose; the tenant's tfvars hold it."
  type        = string
}

variable "archive_prefix" {
  description = "Key prefix inside the bucket — one per tenant when a deployment is shared. Empty otherwise."
  type        = string
  default     = ""
}

variable "object_lock_mode" {
  description = "Object Lock default retention mode. GOVERNANCE keeps an account administrator able to clean up a mistake; COMPLIANCE makes every written object immovable for the retention period, by anyone."
  type        = string
  default     = "GOVERNANCE"
  validation {
    condition     = contains(["GOVERNANCE", "COMPLIANCE"], var.object_lock_mode)
    error_message = "object_lock_mode is GOVERNANCE or COMPLIANCE."
  }
}

variable "object_lock_retention_days" {
  description = "Default retention applied to every object written to the archive."
  type        = number
  default     = 3653
  validation {
    condition     = var.object_lock_retention_days >= 1
    error_message = "Retention is at least one day."
  }
}

variable "digest_contacts" {
  description = "Email addresses that receive each sealed segment's digest — the tenant's named contacts. Each confirms the subscription once."
  type        = list(string)
  default     = []
}

variable "sealer_package" {
  description = "Path to the sealer's zip, produced by `npm run bundle` in spine/ (dist/lambda/sealer.zip)."
  type        = string
}

variable "sealer_schedule" {
  description = "EventBridge Scheduler expression for the sealer, evaluated in UTC. After midnight, over every day before the current one."
  type        = string
  default     = "cron(7 0 * * ? *)"
}

variable "sealer_timeout_seconds" {
  type    = number
  default = 300
}

variable "sealer_memory_mb" {
  type    = number
  default = 512
}

variable "log_retention_days" {
  type    = number
  default = 90
}

variable "alarm_actions" {
  description = "ARNs notified when the sealer errors or fails to run — the tenant's ops-signals topic, once work-service listens to it."
  type        = list(string)
  default     = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
