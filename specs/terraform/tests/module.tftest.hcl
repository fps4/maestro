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
      arn = "arn:aws:dynamodb:eu-west-1::table/aannemer-x-specs"
    }
  }
  mock_resource "aws_s3_bucket" {
    override_during = plan
    defaults = {
      arn    = "arn:aws:s3:::aannemer-x-maestro-specs"
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
  mock_data "aws_secretsmanager_secret_version" {
    defaults = {
      secret_string = "mocked-secret-value"
    }
  }
}

variables {
  bucket_name           = "aannemer-x-maestro-specs"
  api_package           = "./tests/fixtures/app.zip"
  relay_package         = "./tests/fixtures/app.zip"
  web_adapter_layer_arn = "arn:aws:lambda:eu-west-1:aws:layer:LambdaAdapterLayerArm64:30"
  environment = {
    AUTH_MODE     = "jwks"
    AUTH_JWKS_URL = "https://identity.aannemer-x.example/.well-known/jwks.json"
    AUTH_ISSUER   = "https://identity.aannemer-x.example"
    AUTH_AUDIENCE = "specs"
    RECORD_SINK   = "s3" # a tenant's mistake; the module owns this one
  }
  secrets = {
    EVALUATOR_TOKEN = "arn:aws:secretsmanager:eu-west-1::secret:aannemer-x/specs/evaluator-token"
  }
  archive = {
    relay_environment = {
      ARCHIVE_BUCKET   = "aannemer-x-maestro-archive"
      ARCHIVE_PREFIX   = "specs/"
      EVENTS_TOPIC_ARN = "arn:aws:sns:eu-west-1::aannemer-x-spine-events.fifo"
    }
    relay_policy_json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"s3:ListBucket\"],\"Resource\":\"arn:aws:s3:::aannemer-x-maestro-archive\"}]}"
  }
}

run "defaults" {
  command = plan

  # the table: what api/src/db/table.ts declares, and what the service checks at boot
  assert {
    condition     = aws_dynamodb_table.records.name == "maestro-specs" && aws_dynamodb_table.records.hash_key == "pk" && aws_dynamodb_table.records.range_key == "sk"
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
    condition     = aws_lambda_function.api.environment[0].variables["S3_BUCKET"] == "aannemer-x-maestro-specs" && aws_lambda_function.api.environment[0].variables["PAYLOAD_BUCKET"] == "aannemer-x-maestro-specs"
    error_message = "attachments and payloads go to the module's bucket"
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
    condition     = aws_lambda_function.api.environment[0].variables["EVALUATOR_TOKEN"] == "mocked-secret-value"
    error_message = "each secret is read and set as the variable it is named for"
  }
  assert {
    condition     = aws_lambda_function.api.environment[0].variables["TABLE_NAME"] == "maestro-specs" && !contains(keys(aws_lambda_function.api.environment[0].variables), "DYNAMODB_ENDPOINT")
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
    condition     = strcontains(aws_iam_role_policy.api.policy, "dynamodb:TransactWriteItems") && strcontains(aws_iam_role_policy.api.policy, "dynamodb:ConditionCheckItem") && strcontains(aws_iam_role_policy.api.policy, "table/aannemer-x-specs/index/*") && !strcontains(aws_iam_role_policy.api.policy, "dynamodb:Scan") && !strcontains(aws_iam_role_policy.api.policy, "dynamodb:DeleteTable")
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
    condition     = aws_lambda_function.relay.environment[0].variables["ARCHIVE_BUCKET"] == "aannemer-x-maestro-archive" && aws_lambda_function.relay.environment[0].variables["ARCHIVE_PREFIX"] == "specs/" && aws_lambda_function.relay.environment[0].variables["EVENTS_TOPIC_ARN"] == "arn:aws:sns:eu-west-1::aannemer-x-spine-events.fifo" && aws_lambda_function.relay.environment[0].variables["PAYLOAD_BUCKET"] == "aannemer-x-maestro-specs" && !contains(keys(aws_lambda_function.relay.environment[0].variables), "PORT")
    error_message = "the relay carries the spine's three names as the spine's module output them, and the deployment's store, which its config refuses to load without — and none of the API's adapter settings"
  }
  assert {
    condition     = aws_lambda_function.relay.environment[0].variables["TABLE_NAME"] == "maestro-specs" && aws_lambda_function.relay.environment[0].variables["EVALUATOR_TOKEN"] == "mocked-secret-value" && aws_lambda_function.relay.environment[0].variables["AUTH_MODE"] == "jwks"
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
    condition     = aws_cloudwatch_metric_alarm.relay_refused.namespace == "maestro/spine" && aws_cloudwatch_metric_alarm.relay_refused.dimensions["component"] == "specs"
    error_message = "a refused event is an alarm on the spine's metric for this component"
  }
}

run "tenant_overrides" {
  command = plan

  variables {
    name                = "aannemer-x-specs"
    table_name          = "aannemer-x-maestro-specs-records"
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
    condition     = aws_lambda_function.api.function_name == "aannemer-x-specs-api" && aws_lambda_function.relay.function_name == "aannemer-x-specs-relay"
    error_message = "the name prefixes every function"
  }
  assert {
    condition     = aws_dynamodb_table.records.name == "aannemer-x-maestro-specs-records" && aws_lambda_function.api.environment[0].variables["TABLE_NAME"] == "aannemer-x-maestro-specs-records" && aws_lambda_function.relay.environment[0].variables["TABLE_NAME"] == "aannemer-x-maestro-specs-records"
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
    condition     = !contains(keys(aws_lambda_function.api.environment[0].variables), "EVALUATOR_TOKEN")
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
