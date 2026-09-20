variable "application" {
  description = "The application's name in maestro — `app1` in the docs. Names the topic, the heartbeat and the silence alarm; the value of the `maestro:application` tag."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,63}$", var.application))
    error_message = "application is a lower-case token: letters, digits and hyphens, up to 64 characters."
  }
}

variable "environment" {
  description = "The environment this copy of the module observes — one of the application's: dev, test, acceptance, production. The value of the `maestro:environment` tag."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,63}$", var.environment))
    error_message = "environment is a lower-case token: letters, digits and hyphens, up to 64 characters."
  }
}

variable "tier" {
  description = "The application's criticality tier, as the tenant's policy names it — tier1, tier2, tier3 in the docs. Severity and clocks derive from it; the value of the `maestro:tier` tag."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,31}$", var.tier))
    error_message = "tier is a lower-case token: letters, digits and hyphens, up to 32 characters."
  }
}

variable "maestro_account_id" {
  description = "The AWS account maestro's deployment runs in; the topic policy lets it subscribe. No default: it comes from the application's tfvars, never from a repository."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.maestro_account_id))
    error_message = "maestro_account_id is a twelve-digit AWS account id."
  }
}

variable "heartbeat" {
  description = "Emit the heartbeat metric every five minutes and raise the silence alarm when it stops. Off only for an environment nobody would page for."
  type        = bool
  default     = true
}

variable "tags" {
  description = "The application's own tags, applied to everything the module creates. The three maestro tags are added on top and win over anything passed here."
  type        = map(string)
  default     = {}
}
