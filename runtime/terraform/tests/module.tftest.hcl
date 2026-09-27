# Module tests with a mocked provider: no account, no credentials. What they check is the shape the
# design promises — the table keyed and indexed as api/src/db/table.ts declares it, on demand, with
# PITR and TTL; the SBOM store versioned and never public; the API behind the Web Adapter with
# RECORD_SINK=off; every function granted the table and a read of the SBOMs, never a write; the relay
# carrying the spine's names under the spine's policy, on its schedule; the intake on the default bus
# — not whether AWS accepts it. That is proven by the first real tenant (maestro ADR-0017).

# Terraform >= 1.11 (override_during). ARNs are mocked without an account: the public-repository
# guards forbid one, and the policies only need the shape.
mock_provider "aws" {
  mock_resource "aws_dynamodb_table" {
    override_during = plan
    defaults = {
      arn = "arn:aws:dynamodb:eu-west-1::table/aannemer-x-runtime"
    }
  }
  mock_resource "aws_s3_bucket" {
    override_during = plan
    defaults = {
      arn    = "arn:aws:s3:::aannemer-x-maestro-runtime"
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
      arn = "arn:aws:sqs:eu-west-1::maestro-runtime-intake"
      id  = "https://sqs.eu-west-1.amazonaws.com/maestro-runtime-intake"
    }
  }
  mock_resource "aws_cloudwatch_event_rule" {
    override_during = plan
    defaults = {
      arn = "arn:aws:events:eu-west-1::rule/maestro-runtime-intake"
    }
  }
  mock_data "aws_secretsmanager_secret_version" {
    defaults = {
      secret_string = "mocked-secret-value"
    }
  }
}

variables {
  bucket_name           = "aannemer-x-maestro-runtime"
  api_package           = "./tests/fixtures/app.zip"
  relay_package         = "./tests/fixtures/app.zip"
  web_adapter_layer_arn = "arn:aws:lambda:eu-west-1:aws:layer:LambdaAdapterLayerArm64:30"
  environment = {
    AUTH_MODE     = "jwks"
    AUTH_JWKS_URL = "https://identity.aannemer-x.example/.well-known/jwks.json"
    AUTH_ISSUER   = "https://identity.aannemer-x.example"
    AUTH_AUDIENCE = "runtime"
    RECORD_SINK   = "s3" # a tenant's mistake; the module owns this one
  }
  archive = {
    relay_environment = {
      ARCHIVE_BUCKET   = "aannemer-x-maestro-archive"
      ARCHIVE_PREFIX   = "runtime/"
      EVENTS_TOPIC_ARN = "arn:aws:sns:eu-west-1::aannemer-x-spine-events.fifo"
    }
    relay_policy_json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"s3:ListBucket\"],\"Resource\":\"arn:aws:s3:::aannemer-x-maestro-archive\"}]}"
  }
}

run "defaults" {
  command = plan

  # the table: what api/src/db/table.ts declares, and what the service checks at boot
  assert {
    condition     = aws_dynamodb_table.records.name == "maestro-runtime" && aws_dynamodb_table.records.hash_key == "pk" && aws_dynamodb_table.records.range_key == "sk"
    error_message = "one table, named after the module, keyed pk/sk"
  }
  assert {
    condition     = aws_dynamodb_table.records.billing_mode == "PAY_PER_REQUEST" && aws_dynamodb_table.records.point_in_time_recovery[0].enabled && aws_dynamodb_table.records.server_side_encryption[0].enabled
    error_message = "on demand, with point-in-time recovery and encryption at rest"
  }
  assert {
    condition     = aws_dynamodb_table.records.ttl[0].attribute_name == "expires_at" && aws_dynamodb_table.records.ttl[0].enabled
    error_message = "expiry is the table's TTL on expires_at"
  }
  assert {
    condition     = toset([for i in aws_dynamodb_table.records.global_secondary_index : i.name]) == toset(["gsi1", "gsi2", "pending"])
    error_message = "the two general indexes and the sparse pending index, as table.ts names them"
  }

  # the SBOM store
  assert {
    condition     = aws_s3_bucket_versioning.store.versioning_configuration[0].status == "Enabled" && aws_s3_bucket_public_access_block.store.block_public_acls && aws_s3_bucket_public_access_block.store.restrict_public_buckets
    error_message = "the SBOM store is versioned and never public"
  }
  assert {
    condition     = anytrue([for r in aws_s3_bucket_server_side_encryption_configuration.store.rule : r.apply_server_side_encryption_by_default[0].sse_algorithm == "AES256"])
    error_message = "the SBOM store is encrypted at rest"
  }

  # the API behind the Web Adapter
  assert {
    condition     = aws_lambda_function.api.runtime == "nodejs22.x" && aws_lambda_function.api.handler == "run.sh" && contains(aws_lambda_function.api.layers, var.web_adapter_layer_arn) && aws_lambda_function.api.architectures == tolist(["arm64"])
    error_message = "the API runs the bundle on Node 22, arm64, with the Web Adapter starting run.sh"
  }
  assert {
    condition     = aws_lambda_function.api.environment[0].variables["AWS_LAMBDA_EXEC_WRAPPER"] == "/opt/bootstrap" && aws_lambda_function.api.environment[0].variables["PORT"] == "8080" && aws_lambda_function.api.environment[0].variables["AWS_LWA_READINESS_CHECK_PATH"] == "/health"
    error_message = "the adapter proxies to the port the server listens on and waits for /health"
  }
  assert {
    condition     = aws_lambda_function.api.environment[0].variables["RECORD_SINK"] == "off"
    error_message = "the API writes the outbox and relays nothing, whatever the tenant's environment says"
  }
  assert {
    condition     = aws_lambda_function.api.environment[0].variables["SBOM_STORE"] == "s3" && aws_lambda_function.api.environment[0].variables["SBOM_BUCKET"] == "aannemer-x-maestro-runtime" && !contains(keys(aws_lambda_function.api.environment[0].variables), "S3_ENDPOINT")
    error_message = "the SBOMs are read from the module's bucket, at the SDK's endpoint"
  }
  assert {
    condition     = aws_lambda_function.api.environment[0].variables["SIGNALS"] == "log" && !contains(keys(aws_lambda_function.api.environment[0].variables), "WORK_API_URL")
    error_message = "with no signals configured, a mismatch is a log line"
  }
  assert {
    condition     = aws_lambda_function.api.environment[0].variables["TABLE_NAME"] == "maestro-runtime" && aws_lambda_function.api.environment[0].variables["AUTH_MODE"] == "jwks" && aws_lambda_function.api.environment[0].variables["NODE_ENV"] == "production"
    error_message = "the API reads the module's table and the tenant's configuration; a deployment is production"
  }
  assert {
    condition     = aws_lambda_function.api.timeout == 29
    error_message = "the API's timeout defaults to API Gateway's ceiling"
  }
  assert {
    condition     = strcontains(aws_iam_role_policy.api.policy, "dynamodb:TransactWriteItems") && strcontains(aws_iam_role_policy.api.policy, "dynamodb:ConditionCheckItem") && strcontains(aws_iam_role_policy.api.policy, "table/aannemer-x-runtime/index/*") && !strcontains(aws_iam_role_policy.api.policy, "dynamodb:Scan") && !strcontains(aws_iam_role_policy.api.policy, "dynamodb:DeleteTable")
    error_message = "the API is granted the item operations on the table and its indexes — never a scan, never the table itself"
  }
  assert {
    condition     = strcontains(aws_iam_role_policy.api.policy, "arn:aws:s3:::aannemer-x-maestro-runtime/sbom/*") && !strcontains(aws_iam_role_policy.api.policy, "s3:PutObject") && !strcontains(aws_iam_role_policy.api.policy, "s3:DeleteObject") && !strcontains(aws_iam_role_policy.api.policy, "aannemer-x-maestro-archive")
    error_message = "the API reads the SBOMs and writes none; the archive is the relay's"
  }

  # the gateway
  assert {
    condition     = aws_apigatewayv2_api.api.protocol_type == "HTTP" && aws_apigatewayv2_route.default.route_key == "$default" && aws_apigatewayv2_integration.api.payload_format_version == "2.0" && aws_apigatewayv2_stage.default.auto_deploy
    error_message = "an HTTP API with one route for everything, a proxy integration in payload format 2.0, deployed as it changes"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.api_5xx.threshold == 5 && aws_cloudwatch_metric_alarm.api_5xx.metric_name == "5xx"
    error_message = "five server errors in five minutes is an alarm"
  }

  # the relay
  assert {
    condition     = aws_lambda_function.relay.environment[0].variables["ARCHIVE_PREFIX"] == "runtime/" && aws_lambda_function.relay.environment[0].variables["EVENTS_TOPIC_ARN"] == "arn:aws:sns:eu-west-1::aannemer-x-spine-events.fifo" && aws_lambda_function.relay.environment[0].variables["SBOM_BUCKET"] == "aannemer-x-maestro-runtime" && !contains(keys(aws_lambda_function.relay.environment[0].variables), "PORT")
    error_message = "the relay carries the spine's names and the bucket its config refuses to load without — and none of the API's adapter settings"
  }
  assert {
    condition     = aws_iam_role_policy.relay_archive.policy == var.archive.relay_policy_json && !strcontains(aws_iam_role_policy.relay_logs.policy, "s3:") && !strcontains(aws_iam_role_policy.relay_logs.policy, "dynamodb:Scan")
    error_message = "the relay's own policy is its log and its table; the archive comes from the spine's policy, attached unchanged"
  }
  assert {
    condition     = aws_lambda_function.relay.reserved_concurrent_executions == 1 && aws_scheduler_schedule.relay.schedule_expression == "rate(1 minute)"
    error_message = "one relay at a time, every minute"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.relay_silent.treat_missing_data == "breaching" && aws_cloudwatch_metric_alarm.relay_refused.dimensions["component"] == "runtime"
    error_message = "a silent relay and a refused event are alarms, on the spine's metric for this component"
  }

  # no intake unless the tenant asks for one
  assert {
    condition     = length(aws_lambda_function.intake) == 0 && length(aws_sqs_queue.intake) == 0 && length(aws_cloudwatch_event_rule.intake) == 0
    error_message = "no intake unless the tenant asks for one"
  }
}

run "tenant_overrides" {
  command = plan

  variables {
    name                = "aannemer-x-runtime"
    table_name          = "aannemer-x-maestro-runtime-records"
    relay_schedule      = "rate(5 minutes)"
    api_timeout_seconds = 15
    environment = {
      NODE_ENV   = "development"
      TABLE_NAME = "somebody-elses-table" # a tenant's mistake; the module owns this one
    }
  }

  assert {
    condition     = aws_lambda_function.api.function_name == "aannemer-x-runtime-api" && aws_lambda_function.relay.function_name == "aannemer-x-runtime-relay"
    error_message = "the name prefixes every function"
  }
  assert {
    condition     = aws_dynamodb_table.records.name == "aannemer-x-maestro-runtime-records" && aws_lambda_function.api.environment[0].variables["TABLE_NAME"] == "aannemer-x-maestro-runtime-records"
    error_message = "the tenant may name the table; the functions read the one the module made"
  }
  assert {
    condition     = aws_scheduler_schedule.relay.schedule_expression == "rate(5 minutes)" && aws_lambda_function.api.timeout == 15 && aws_lambda_function.api.environment[0].variables["NODE_ENV"] == "development"
    error_message = "the tenant chose the schedule, the timeout and NODE_ENV"
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
      relay_environment = { ARCHIVE_BUCKET = "aannemer-x-maestro-archive" }
      relay_policy_json = "{}"
    }
  }
  expect_failures = [var.archive]
}

run "archive_prefix_override" {
  command = plan
  variables {
    archive_prefix = "runtime-demo/"
  }
  assert {
    condition     = aws_lambda_function.relay.environment[0].variables["ARCHIVE_PREFIX"] == "runtime-demo/" && aws_lambda_function.relay.environment[0].variables["ARCHIVE_BUCKET"] == "aannemer-x-maestro-archive"
    error_message = "archive_prefix moves the relay's prefix and keeps the spine's bucket"
  }
}

run "intake" {
  command = plan
  variables {
    intake_package = "./tests/fixtures/app.zip"
    intake = {
      principal = "prn-w-runtime-intake-demo"
      workspace = "aannemer-x"
    }
  }
  assert {
    condition     = aws_lambda_function.intake[0].environment[0].variables["INTAKE_PRINCIPAL"] == "prn-w-runtime-intake-demo" && aws_lambda_function.intake[0].environment[0].variables["INTAKE_WORKSPACE"] == "aannemer-x" && aws_lambda_function.intake[0].environment[0].variables["RECORD_SINK"] == "off"
    error_message = "the intake acts as the named workload in the named workspace and relays nothing"
  }
  assert {
    condition     = strcontains(aws_cloudwatch_event_rule.intake[0].event_pattern, "maestro.build") && strcontains(aws_cloudwatch_event_rule.intake[0].event_pattern, "maestro.deploy")
    error_message = "build records and deploys are routed to the queue"
  }
  assert {
    condition     = contains(aws_lambda_event_source_mapping.intake[0].function_response_types, "ReportBatchItemFailures") && aws_sqs_queue.intake[0].visibility_timeout_seconds == 360
    error_message = "a failed record is retried alone, and never while the function still holds it"
  }
  assert {
    condition     = strcontains(aws_iam_role_policy.intake[0].policy, "sqs:DeleteMessage") && strcontains(aws_iam_role_policy.intake[0].policy, "/sbom/*") && !strcontains(aws_iam_role_policy.intake[0].policy, "dynamodb:Scan") && !strcontains(aws_iam_role_policy.intake[0].policy, "s3:PutObject")
    error_message = "the intake reads and deletes its queue, reads the SBOMs, writes the table, never Scan, never an SBOM"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.intake_dead_letters[0].threshold == 1
    error_message = "one dead letter is an alarm"
  }
  assert {
    condition     = aws_lambda_function.intake[0].environment[0].variables["SIGNALS"] == "log"
    error_message = "no signals configured: the intake's mismatches are log lines too"
  }
}

run "intake_sources" {
  command = plan
  variables {
    intake_package = "./tests/fixtures/app.zip"
    intake = {
      principal = "prn-w-runtime-intake-demo"
      workspace = "aannemer-x"
      sources   = ["aannemer-x.deploy"]
    }
  }
  assert {
    condition     = strcontains(aws_cloudwatch_event_rule.intake[0].event_pattern, "aannemer-x.deploy") && !strcontains(aws_cloudwatch_event_rule.intake[0].event_pattern, "maestro.build")
    error_message = "a tenant may name its own sources"
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

run "signals_to_work_service" {
  command = plan
  variables {
    intake_package = "./tests/fixtures/app.zip"
    intake         = { principal = "prn-w-runtime-intake-demo", workspace = "aannemer-x" }
    signals = {
      work_api_url = "https://work.aannemer-x.example"
      token_url    = "https://identity.aannemer-x.example/oauth2/token"
      client_id    = "maestro-runtime-signals"
    }
    secrets = {
      SIGNALS_CLIENT_SECRET = "arn:aws:secretsmanager:eu-west-1::secret:aannemer-x/runtime/signals"
    }
  }
  assert {
    condition = alltrue([for f in [aws_lambda_function.api, aws_lambda_function.intake[0]] :
      f.environment[0].variables["SIGNALS"] == "work"
      && f.environment[0].variables["WORK_API_URL"] == "https://work.aannemer-x.example"
      && f.environment[0].variables["SIGNALS_TOKEN_URL"] == "https://identity.aannemer-x.example/oauth2/token"
      && f.environment[0].variables["SIGNALS_CLIENT_ID"] == "maestro-runtime-signals"
      && f.environment[0].variables["SIGNALS_CLIENT_SECRET"] == "mocked-secret-value"
    ])
    error_message = "both functions that record deploys send a mismatch to work-service, with the client's secret"
  }
}
