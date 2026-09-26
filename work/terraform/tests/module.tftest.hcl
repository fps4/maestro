# Module tests with a mocked provider: no account, no credentials. What they check is the shape the
# design promises — the table keyed and indexed as api/src/db/table.ts declares it, on demand, with
# PITR and TTL; the store versioned and never Object-Locked; the API behind the Web Adapter with
# RECORD_SINK=off; both functions granted the table and no credential; the relay carrying the
# spine's names under the spine's policy, on its schedule — not whether AWS accepts it. That is
# proven by the first real tenant (maestro ADR-0017).

# Terraform >= 1.11 (override_during). ARNs are mocked without an account: the public-repository
# guards forbid one, and the policies only need the shape.
mock_provider "aws" {
  mock_resource "aws_dynamodb_table" {
    override_during = plan
    defaults = {
      arn = "arn:aws:dynamodb:eu-west-1::table/aannemer-x-work"
    }
  }
  mock_resource "aws_s3_bucket" {
    override_during = plan
    defaults = {
      arn    = "arn:aws:s3:::aannemer-x-maestro-work"
      region = "eu-west-1"
    }
  }
  mock_resource "aws_cloudwatch_log_group" {
    override_during = plan
    defaults = {
      arn = "arn:aws:logs:eu-west-1::log-group:/aws/lambda/example"
    }
  }
  mock_resource "aws_iam_role" {
    override_during = plan
    defaults = {
      arn = "arn:aws:iam:::role/example"
    }
  }
  mock_resource "aws_lambda_function" {
    override_during = plan
    defaults = {
      arn        = "arn:aws:lambda:eu-west-1::function:example"
      invoke_arn = "arn:aws:apigateway:eu-west-1:lambda:path/2015-03-31/functions/arn:aws:lambda:eu-west-1::function:example/invocations"
    }
  }
  mock_resource "aws_apigatewayv2_api" {
    override_during = plan
    defaults = {
      id            = "example00"
      api_endpoint  = "https://example00.execute-api.eu-west-1.amazonaws.com"
      execution_arn = "arn:aws:execute-api:eu-west-1::example00"
    }
  }
  mock_resource "aws_apigatewayv2_integration" {
    override_during = plan
    defaults = {
      id = "integ000"
    }
  }
  mock_resource "aws_sqs_queue" {
    override_during = plan
    defaults = {
      arn = "arn:aws:sqs:eu-west-1::maestro-work-intake"
      id  = "https://sqs.eu-west-1.amazonaws.com/maestro-work-intake"
    }
  }
  mock_resource "aws_cloudwatch_event_rule" {
    override_during = plan
    defaults = {
      arn = "arn:aws:events:eu-west-1::rule/maestro-work-intake-deploys"
    }
  }
  mock_data "aws_secretsmanager_secret_version" {
    defaults = {
      secret_string = "mocked-secret-value"
    }
  }
}

variables {
  bucket_name           = "aannemer-x-maestro-work"
  api_package           = "./tests/fixtures/app.zip"
  relay_package         = "./tests/fixtures/app.zip"
  sweep_package         = "./tests/fixtures/app.zip"
  sweep_principal       = "prn-w-work-demo"
  web_adapter_layer_arn = "arn:aws:lambda:eu-west-1:aws:layer:LambdaAdapterLayerArm64:30"
  environment = {
    AUTH_MODE     = "jwks"
    AUTH_JWKS_URL = "https://identity.aannemer-x.example/.well-known/jwks.json"
    AUTH_ISSUER   = "https://identity.aannemer-x.example"
    AUTH_AUDIENCE = "work"
    RECORD_SINK   = "s3" # a tenant's mistake; the module owns this one
  }
  secrets = {
    SLACK_WEBHOOK_URL = "arn:aws:secretsmanager:eu-west-1::secret:aannemer-x/work/slack-webhook"
  }
  archive = {
    relay_environment = {
      ARCHIVE_BUCKET   = "aannemer-x-maestro-archive"
      ARCHIVE_PREFIX   = "work/"
      EVENTS_TOPIC_ARN = "arn:aws:sns:eu-west-1::aannemer-x-spine-events.fifo"
    }
    relay_policy_json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"s3:ListBucket\"],\"Resource\":\"arn:aws:s3:::aannemer-x-maestro-archive\"}]}"
  }
}

run "defaults" {
  command = plan

  # the table: what api/src/db/table.ts declares, and what the service checks at boot
  assert {
    condition     = aws_dynamodb_table.records.name == "maestro-work" && aws_dynamodb_table.records.hash_key == "pk" && aws_dynamodb_table.records.range_key == "sk"
    error_message = "one table, named after the module, keyed pk/sk"
  }
  assert {
    condition     = aws_dynamodb_table.records.billing_mode == "PAY_PER_REQUEST"
    error_message = "on demand: an idle tenant pays for bytes only"
  }
  assert {
    condition     = aws_dynamodb_table.records.point_in_time_recovery[0].enabled && aws_dynamodb_table.records.server_side_encryption[0].enabled
    error_message = "point-in-time recovery and encryption at rest are on"
  }
  assert {
    condition     = aws_dynamodb_table.records.ttl[0].attribute_name == "expires_at" && aws_dynamodb_table.records.ttl[0].enabled
    error_message = "expiry is the table's TTL on expires_at"
  }
  assert {
    condition     = toset([for i in aws_dynamodb_table.records.global_secondary_index : i.name]) == toset(["gsi1", "gsi2", "pending"])
    error_message = "the two general indexes and the sparse pending index, as table.ts names them"
  }
  assert {
    condition     = alltrue([for i in aws_dynamodb_table.records.global_secondary_index : i.hash_key == "${i.name == "pending" ? "pending_" : i.name}${i.name == "pending" ? "pk" : "pk"}" && i.range_key == "${i.name == "pending" ? "pending_" : i.name}sk" && i.projection_type == "ALL"])
    error_message = "each index is keyed <name>pk/<name>sk (pending_pk/pending_sk) and projects the whole item"
  }

  # the store
  assert {
    condition     = aws_s3_bucket.store.object_lock_enabled == false
    error_message = "payloads must be erasable (ADR-0020): the store is never Object-Locked"
  }
  assert {
    condition     = aws_s3_bucket_versioning.store.versioning_configuration[0].status == "Enabled"
    error_message = "the store is versioned"
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.store.block_public_acls && aws_s3_bucket_public_access_block.store.restrict_public_buckets
    error_message = "the store is never public"
  }
  assert {
    condition     = anytrue([for r in aws_s3_bucket_server_side_encryption_configuration.store.rule : r.apply_server_side_encryption_by_default[0].sse_algorithm == "AES256"])
    error_message = "the store is encrypted at rest"
  }

  # the API behind the Web Adapter
  assert {
    condition     = aws_lambda_function.api.runtime == "nodejs22.x" && aws_lambda_function.api.handler == "run.sh"
    error_message = "the API runs the bundle on Node 22; the handler is the script the adapter starts"
  }
  assert {
    condition     = contains(aws_lambda_function.api.layers, var.web_adapter_layer_arn)
    error_message = "the API carries the Web Adapter layer"
  }
  assert {
    condition     = aws_lambda_function.api.environment[0].variables["AWS_LAMBDA_EXEC_WRAPPER"] == "/opt/bootstrap"
    error_message = "the adapter is started by AWS_LAMBDA_EXEC_WRAPPER"
  }
  assert {
    condition     = aws_lambda_function.api.environment[0].variables["PORT"] == "8080" && aws_lambda_function.api.environment[0].variables["AWS_LWA_READINESS_CHECK_PATH"] == "/health"
    error_message = "the adapter proxies to the port the server listens on and waits for /health"
  }
  assert {
    condition     = aws_lambda_function.api.environment[0].variables["RECORD_SINK"] == "off"
    error_message = "the API writes the outbox and relays nothing, whatever the tenant's environment says"
  }
  assert {
    condition     = aws_lambda_function.api.environment[0].variables["S3_BUCKET"] == "aannemer-x-maestro-work" && aws_lambda_function.api.environment[0].variables["PAYLOAD_BUCKET"] == "aannemer-x-maestro-work"
    error_message = "payloads go to the module's bucket"
  }
  assert {
    condition     = aws_lambda_function.api.environment[0].variables["S3_REGION"] == "eu-west-1" && aws_lambda_function.api.environment[0].variables["S3_FORCE_PATH_STYLE"] == "false" && !contains(keys(aws_lambda_function.api.environment[0].variables), "S3_ENDPOINT")
    error_message = "on AWS the SDK's endpoint applies: the bucket's region, virtual-host style, no S3_ENDPOINT"
  }
  assert {
    condition     = aws_lambda_function.api.environment[0].variables["AUTH_MODE"] == "jwks" && aws_lambda_function.api.environment[0].variables["NODE_ENV"] == "production"
    error_message = "the tenant's environment reaches the API; a deployment is production unless it says otherwise"
  }
  assert {
    condition     = aws_lambda_function.api.environment[0].variables["SLACK_WEBHOOK_URL"] == "mocked-secret-value"
    error_message = "each secret is read and set as the variable it is named for"
  }
  assert {
    condition     = aws_lambda_function.api.environment[0].variables["TABLE_NAME"] == "maestro-work" && !contains(keys(aws_lambda_function.api.environment[0].variables), "DYNAMODB_ENDPOINT")
    error_message = "the API reads the module's table by name, at the SDK's endpoint for the region"
  }
  assert {
    condition     = length([for k in keys(aws_lambda_function.api.environment[0].variables) : k if startswith(k, "MONGO")]) == 0
    error_message = "no database credential exists (maestro ADR-0018)"
  }
  assert {
    condition     = aws_lambda_function.api.timeout == 29
    error_message = "the API's timeout defaults to API Gateway's ceiling"
  }
  assert {
    condition     = !strcontains(aws_iam_role_policy.api.policy, "\"Resource\":\"*\"") && !strcontains(aws_iam_role_policy.api.policy, "sns:") && !strcontains(aws_iam_role_policy.api.policy, "aannemer-x-maestro-archive")
    error_message = "the API's role reaches its log, its table and its bucket, nothing else — the archive is the relay's"
  }
  assert {
    condition     = strcontains(aws_iam_role_policy.api.policy, "dynamodb:TransactWriteItems") && strcontains(aws_iam_role_policy.api.policy, "dynamodb:ConditionCheckItem") && strcontains(aws_iam_role_policy.api.policy, "table/aannemer-x-work/index/*") && !strcontains(aws_iam_role_policy.api.policy, "dynamodb:Scan") && !strcontains(aws_iam_role_policy.api.policy, "dynamodb:DeleteTable")
    error_message = "the API is granted the item operations on the table and its indexes — never a scan, never the table itself"
  }

  # the gateway
  assert {
    condition     = aws_apigatewayv2_api.api.protocol_type == "HTTP" && aws_apigatewayv2_route.default.route_key == "$default"
    error_message = "an HTTP API with one route for everything"
  }
  assert {
    condition     = aws_apigatewayv2_integration.api.payload_format_version == "2.0" && aws_apigatewayv2_integration.api.integration_type == "AWS_PROXY"
    error_message = "a Lambda proxy integration in payload format 2.0"
  }
  assert {
    condition     = aws_apigatewayv2_stage.default.auto_deploy == true
    error_message = "the default stage deploys as it changes"
  }
  assert {
    condition     = aws_lambda_permission.gateway.principal == "apigateway.amazonaws.com"
    error_message = "the gateway may invoke the API"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.api_5xx.threshold == 5 && aws_cloudwatch_metric_alarm.api_5xx.period == 300 && aws_cloudwatch_metric_alarm.api_5xx.metric_name == "5xx"
    error_message = "five server errors in five minutes is an alarm"
  }

  # the relay
  assert {
    condition     = aws_lambda_function.relay.runtime == "nodejs22.x" && aws_lambda_function.relay.handler == "index.handler"
    error_message = "the relay runs the bundle on Node 22"
  }
  assert {
    condition     = aws_lambda_function.relay.environment[0].variables["ARCHIVE_BUCKET"] == "aannemer-x-maestro-archive" && aws_lambda_function.relay.environment[0].variables["ARCHIVE_PREFIX"] == "work/" && aws_lambda_function.relay.environment[0].variables["EVENTS_TOPIC_ARN"] == "arn:aws:sns:eu-west-1::aannemer-x-spine-events.fifo" && aws_lambda_function.relay.environment[0].variables["PAYLOAD_BUCKET"] == "aannemer-x-maestro-work" && !contains(keys(aws_lambda_function.relay.environment[0].variables), "PORT")
    error_message = "the relay carries the spine's three names as the spine's module output them, and the deployment's store, which its config refuses to load without — and none of the API's adapter settings"
  }
  assert {
    condition     = aws_lambda_function.relay.environment[0].variables["TABLE_NAME"] == "maestro-work" && aws_lambda_function.relay.environment[0].variables["SLACK_WEBHOOK_URL"] == "mocked-secret-value" && aws_lambda_function.relay.environment[0].variables["AUTH_MODE"] == "jwks"
    error_message = "the relay reads the same table and configuration as the API"
  }
  assert {
    condition     = strcontains(aws_iam_role_policy.relay_logs.policy, "dynamodb:Query") && strcontains(aws_iam_role_policy.relay_logs.policy, "dynamodb:UpdateItem") && !strcontains(aws_iam_role_policy.relay_logs.policy, "dynamodb:Scan")
    error_message = "the relay is granted the table: it reads pending and acks"
  }
  assert {
    condition     = aws_iam_role_policy.relay_archive.policy == var.archive.relay_policy_json
    error_message = "the relay's archive policy is the spine's, attached unchanged"
  }
  assert {
    condition     = !strcontains(aws_iam_role_policy.relay_logs.policy, "s3:")
    error_message = "the relay's own policy is its log and its table; the archive comes from the spine's policy"
  }
  assert {
    condition     = aws_lambda_function.relay.reserved_concurrent_executions == 1
    error_message = "one relay at a time"
  }
  assert {
    condition     = aws_scheduler_schedule.relay.schedule_expression == "rate(1 minute)" && aws_scheduler_schedule.relay.flexible_time_window[0].mode == "OFF"
    error_message = "the relay runs every minute, on the minute"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.relay_silent.treat_missing_data == "breaching" && aws_cloudwatch_metric_alarm.relay_silent.period == 900
    error_message = "a relay that has not run in fifteen minutes is an alarm, not a quiet quarter-hour"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.relay_errors.threshold == 1
    error_message = "one relay error is an alarm"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.relay_refused.namespace == "maestro/spine" && aws_cloudwatch_metric_alarm.relay_refused.dimensions["component"] == "work"
    error_message = "a refused event is an alarm on the spine's metric for this component"
  }
}

run "tenant_overrides" {
  command = plan

  variables {
    name                = "aannemer-x-work"
    table_name          = "aannemer-x-maestro-work-records"
    relay_schedule      = "rate(5 minutes)"
    api_timeout_seconds = 15
    environment = {
      NODE_ENV   = "development"
      AUTH_MODE  = "dev"
      TABLE_NAME = "somebody-elses-table" # a tenant's mistake; the module owns this one
    }
    secrets = {}
  }

  assert {
    condition     = aws_lambda_function.api.function_name == "aannemer-x-work-api" && aws_lambda_function.relay.function_name == "aannemer-x-work-relay"
    error_message = "the name prefixes every function"
  }
  assert {
    condition     = aws_dynamodb_table.records.name == "aannemer-x-maestro-work-records" && aws_lambda_function.api.environment[0].variables["TABLE_NAME"] == "aannemer-x-maestro-work-records" && aws_lambda_function.relay.environment[0].variables["TABLE_NAME"] == "aannemer-x-maestro-work-records"
    error_message = "the tenant may name the table; both functions read the one the module made, whatever the tenant's environment says"
  }
  assert {
    condition     = aws_scheduler_schedule.relay.schedule_expression == "rate(5 minutes)"
    error_message = "the tenant chose the relay's schedule"
  }
  assert {
    condition     = aws_lambda_function.api.timeout == 15
    error_message = "the tenant chose a shorter timeout"
  }
  assert {
    condition     = aws_lambda_function.api.environment[0].variables["NODE_ENV"] == "development"
    error_message = "NODE_ENV is a default the tenant may override; the module's own variables are not"
  }
  assert {
    condition     = !contains(keys(aws_lambda_function.api.environment[0].variables), "SLACK_WEBHOOK_URL")
    error_message = "no secrets, no secret variables"
  }
}

run "rejects_a_timeout_past_the_gateway" {
  command = plan

  variables {
    api_timeout_seconds = 30
  }

  expect_failures = [var.api_timeout_seconds]
}

run "rejects_an_x86_layer" {
  command = plan

  variables {
    web_adapter_layer_arn = "arn:aws:lambda:eu-west-1:aws:layer:LambdaAdapterLayerX86:30"
  }

  expect_failures = [var.web_adapter_layer_arn]
}

run "rejects_an_archive_missing_a_name" {
  command = plan

  variables {
    archive = {
      relay_environment = {
        ARCHIVE_BUCKET = "aannemer-x-maestro-archive"
      }
      relay_policy_json = "{}"
    }
  }

  expect_failures = [var.archive]
}

run "archive_prefix_override" {
  command = plan

  variables {
    archive_prefix = "work/"
  }

  assert {
    condition     = aws_lambda_function.relay.environment[0].variables["ARCHIVE_PREFIX"] == "work/" && aws_lambda_function.relay.environment[0].variables["ARCHIVE_BUCKET"] == "aannemer-x-maestro-archive"
    error_message = "archive_prefix moves the relay's prefix and keeps the spine's bucket"
  }
}

run "sweep" {
  command = plan

  assert {
    condition     = aws_lambda_function.sweep.handler == "index.handler" && aws_lambda_function.sweep.reserved_concurrent_executions == 1
    error_message = "one sweep at a time, the bundle's handler"
  }
  assert {
    condition     = aws_lambda_function.sweep.environment[0].variables["SWEEP_PRINCIPAL"] == "prn-w-work-demo" && aws_lambda_function.sweep.environment[0].variables["SWEEP_MODE"] == "off" && aws_lambda_function.sweep.environment[0].variables["RECORD_SINK"] == "off" && aws_lambda_function.sweep.environment[0].variables["TABLE_NAME"] == "maestro-work"
    error_message = "the sweep acts as the named workload, on the table, relaying nothing"
  }
  assert {
    condition     = aws_lambda_function.sweep.environment[0].variables["SLACK_WEBHOOK_URL"] == "mocked-secret-value"
    error_message = "the sweep delivers ladder steps, so it carries the notifier's secret"
  }
  assert {
    condition     = aws_lambda_function.api.environment[0].variables["SWEEP_MODE"] == "off"
    error_message = "the API runs no sweep of its own: every container would keep the clocks"
  }
  assert {
    condition     = strcontains(aws_iam_role_policy.sweep.policy, "dynamodb:TransactWriteItems") && !strcontains(aws_iam_role_policy.sweep.policy, "dynamodb:Scan") && !strcontains(aws_iam_role_policy.sweep.policy, "s3:DeleteObject")
    error_message = "the sweep is granted the table's item operations and payload writes, never Scan or delete"
  }
  assert {
    condition     = aws_scheduler_schedule.sweep.schedule_expression == "rate(1 minute)" && aws_scheduler_schedule.sweep.flexible_time_window[0].mode == "OFF"
    error_message = "the sweep runs every minute, on the minute: a clock is late by at most that"
  }
  assert {
    condition     = strcontains(aws_iam_role_policy.scheduler.policy, "lambda:InvokeFunction")
    error_message = "the schedule may invoke the relay and the sweep"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.sweep_silent.treat_missing_data == "breaching" && aws_cloudwatch_metric_alarm.sweep_silent.period == 900
    error_message = "a sweep that has not run in fifteen minutes is an alarm: nothing is keeping the clocks"
  }
}

run "sweep_principal_is_a_workload" {
  command = plan
  variables {
    sweep_principal = "prn-h-someone"
  }
  expect_failures = [var.sweep_principal]
}

run "no_intake_by_default" {
  command = plan
  assert {
    condition     = length(aws_lambda_function.intake) == 0 && length(aws_sqs_queue.signals) == 0 && !contains(keys(aws_lambda_function.api.environment[0].variables), "INTAKE_PRINCIPAL")
    error_message = "no intake unless the tenant asks for one"
  }
}

run "intake" {
  command = plan
  variables {
    intake_package = "./tests/fixtures/app.zip"
    intake = {
      principal         = "prn-w-intake-demo"
      workspace         = "aannemer-x"
      signal_topic_arns = ["arn:aws:sns:eu-west-1::app1-prod-ops-signals"]
    }
  }
  assert {
    condition     = aws_lambda_function.intake[0].environment[0].variables["INTAKE_PRINCIPAL"] == "prn-w-intake-demo" && aws_lambda_function.intake[0].environment[0].variables["INTAKE_WORKSPACE"] == "aannemer-x" && aws_lambda_function.intake[0].environment[0].variables["SLACK_WEBHOOK_URL"] == "mocked-secret-value"
    error_message = "the intake acts as the named workload in the named workspace, with the service's configuration"
  }
  assert {
    condition     = aws_lambda_function.api.environment[0].variables["INTAKE_PRINCIPAL"] == "prn-w-intake-demo"
    error_message = "the API's GitHub webhook acts as the same workload"
  }
  assert {
    condition     = contains(aws_lambda_event_source_mapping.intake[0].function_response_types, "ReportBatchItemFailures") && aws_sqs_queue.signals[0].visibility_timeout_seconds == 360
    error_message = "a failed record is retried alone, and never while the function still holds it"
  }
  assert {
    condition     = length(aws_sns_topic_subscription.signals) == 1 && aws_sns_topic_subscription.signals["arn:aws:sns:eu-west-1::app1-prod-ops-signals"].protocol == "sqs"
    error_message = "one subscription per application topic"
  }
  assert {
    condition     = strcontains(aws_cloudwatch_event_rule.deploys[0].event_pattern, "maestro.deploy")
    error_message = "deploy events are routed to the queue"
  }
  assert {
    condition     = strcontains(aws_iam_role_policy.intake[0].policy, "sqs:DeleteMessage") && !strcontains(aws_iam_role_policy.intake[0].policy, "dynamodb:Scan")
    error_message = "the intake reads and deletes its queue and writes the table, never Scan"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.intake_dead_letters[0].threshold == 1
    error_message = "one dead letter is an alarm"
  }
}

run "intake_principal_is_a_workload" {
  command = plan
  variables {
    intake_package = "./tests/fixtures/app.zip"
    intake         = { principal = "prn-h-someone", workspace = "x" }
  }
  expect_failures = [var.intake]
}
