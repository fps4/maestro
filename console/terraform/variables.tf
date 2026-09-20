variable "name" {
  description = "Prefix for every named resource: <name>-server, <name>-signer, <name>-images, … — e.g. maestro-specs-console."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,47}$", var.name))
    error_message = "name is a lower-case token: letters, digits and hyphens, up to 48 characters."
  }
}

variable "open_next_dir" {
  description = <<-EOT
    Path to the `.open-next/` directory `npx @opennextjs/aws build` wrote in the console's directory.
    Its `open-next.output.json` is what the module reads: which directories are the assets, which
    function is the server, which path patterns go where. A relative path is resolved from the
    root module's working directory; pass an absolute one or build it from the root's path.module.
  EOT
  type        = string
  validation {
    condition     = fileexists("${var.open_next_dir}/open-next.output.json")
    error_message = "open_next_dir must hold open-next.output.json — the directory `npx @opennextjs/aws build` writes."
  }
}

variable "environment" {
  description = <<-EOT
    Environment variables for the server function: what the console reads at request time on the
    server — the API's base URL, feature switches. NEXT_PUBLIC_* variables are not read here: Next
    inlines them into the browser bundle at `next build`, so they are set in the environment of the
    build step, before the module ever sees the output.
  EOT
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = <<-EOT
    Environment variable → Secrets Manager secret ARN, read at plan time and set on the server
    function — a break-glass API token, a session-signing key. The value lands in the state and in
    the function's configuration, as a secret in any Lambda environment does; the state bucket is
    what protects it (ADR-0017). Reading at boot through the Parameters and Secrets Lambda
    extension is the follow-up, once a console reads its configuration from there.
  EOT
  type        = map(string)
  default     = {}
}

variable "domain" {
  description = "The console's own host name, when the tenant names one. DNS is the root's: an alias to `distribution_domain_name`. Without it the console answers on the distribution's *.cloudfront.net name."
  type        = string
  default     = null
}

variable "certificate_arn" {
  description = "ACM certificate for `domain`. CloudFront accepts certificates from us-east-1 only, whatever the deployment's region; the root issues it through its `aws.us_east_1` configuration."
  type        = string
  default     = null
  validation {
    condition     = var.certificate_arn == null || can(regex("^arn:[a-z-]+:acm:us-east-1:", var.certificate_arn))
    error_message = "certificate_arn must be an ACM certificate in us-east-1: CloudFront reads certificates from that region only."
  }
}

variable "assets_bucket_name" {
  description = "The bucket the static assets are served from. Globally unique, the tenant's to choose; the tenant's tfvars hold it."
  type        = string
}

variable "price_class" {
  description = "Which CloudFront edge locations serve the console. PriceClass_100 is North America and Europe; a console's users sit in one place."
  type        = string
  default     = "PriceClass_100"
  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.price_class)
    error_message = "price_class is PriceClass_100, PriceClass_200 or PriceClass_All."
  }
}

variable "log_retention_days" {
  type    = number
  default = 90
}

variable "memory_mb" {
  description = "Memory for the server function. A Next.js server renders in a few hundred MB; 1024 keeps cold starts short."
  type        = number
  default     = 1024
}

variable "timeout_seconds" {
  description = "Timeout for the server function. CloudFront waits at most 60 seconds for an origin, so the ceiling is 60."
  type        = number
  default     = 10
  validation {
    condition     = var.timeout_seconds >= 1 && var.timeout_seconds <= 60
    error_message = "timeout_seconds is between 1 and 60: CloudFront's origin read timeout goes no higher."
  }
}

variable "image_optimization" {
  description = "Deploy OpenNext's image optimisation function and route `_next/image*` to it. Off by default: the consoles use no `next/image`. When off, a console that does must set `images.unoptimized` in next.config, or its images 404."
  type        = bool
  default     = false
}

variable "alarm_actions" {
  description = "ARNs notified when the server function errors — the tenant's ops-signals topic, once work-service listens to it."
  type        = list(string)
  default     = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
