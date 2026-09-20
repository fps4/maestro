# Module tests with a mocked provider: no account, no credentials. What they check is the shape
# the design promises — Object Lock on, versioning on, the topic FIFO, the sealer on Node 22 with
# the environment the handler reads, no delete in any policy — not whether AWS accepts it. That
# is proven by the first real tenant (ADR-0017).

# Terraform >= 1.11 (override_during). ARNs are mocked without an account: the public-repository
# guards forbid one, and the policies only need the shape.
mock_provider "aws" {
  mock_resource "aws_s3_bucket" {
    override_during = plan
    defaults = {
      arn = "arn:aws:s3:::example-maestro-archive"
    }
  }
  mock_resource "aws_sns_topic" {
    override_during = plan
    defaults = {
      arn = "arn:aws:sns:eu-west-1::example-topic"
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
      arn = "arn:aws:lambda:eu-west-1::function:example"
    }
  }
}

variables {
  archive_bucket_name = "example-maestro-archive"
  sealer_package      = "./tests/fixtures/sealer.zip"
  digest_contacts     = ["ops@aannemer-x.example", "audit@aannemer-x.example"]
}

run "defaults" {
  command = plan

  assert {
    condition     = aws_s3_bucket.archive.object_lock_enabled == true
    error_message = "the archive bucket must have Object Lock enabled at creation"
  }
  assert {
    condition     = aws_s3_bucket_versioning.archive.versioning_configuration[0].status == "Enabled"
    error_message = "Object Lock requires versioning"
  }
  assert {
    condition     = aws_s3_bucket_object_lock_configuration.archive.rule[0].default_retention[0].mode == "GOVERNANCE"
    error_message = "default retention mode is GOVERNANCE unless the tenant says COMPLIANCE"
  }
  assert {
    condition     = aws_s3_bucket_object_lock_configuration.archive.rule[0].default_retention[0].days == 3653
    error_message = "default retention is ten years"
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.archive.block_public_acls && aws_s3_bucket_public_access_block.archive.restrict_public_buckets
    error_message = "the archive is never public"
  }
  assert {
    condition     = aws_sns_topic.events.fifo_topic == true && endswith(aws_sns_topic.events.name, ".fifo")
    error_message = "delivery is a FIFO topic"
  }
  assert {
    condition     = aws_sns_topic.events.content_based_deduplication == false
    error_message = "deduplication is by event_id, set by the relay, not by content"
  }
  assert {
    condition     = length(aws_sns_topic_subscription.digest) == 2
    error_message = "one email subscription per digest contact"
  }
  assert {
    condition     = aws_lambda_function.sealer.runtime == "nodejs22.x" && aws_lambda_function.sealer.handler == "index.handler"
    error_message = "the sealer runs the bundle on Node 22"
  }
  assert {
    condition     = aws_lambda_function.sealer.environment[0].variables["ARCHIVE_BUCKET"] == "example-maestro-archive"
    error_message = "the sealer reads ARCHIVE_BUCKET"
  }
  assert {
    condition     = contains(keys(aws_lambda_function.sealer.environment[0].variables), "DIGEST_TOPIC_ARN")
    error_message = "the sealer reads DIGEST_TOPIC_ARN"
  }
  assert {
    condition     = aws_scheduler_schedule.sealer.schedule_expression == "cron(7 0 * * ? *)" && aws_scheduler_schedule.sealer.schedule_expression_timezone == "UTC"
    error_message = "the sealer runs after midnight UTC"
  }
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.sealer_errors) == 1 && length(aws_cloudwatch_metric_alarm.sealer_silent) == 1
    error_message = "both alarms exist unless the root is a LocalStack stand-in"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.sealer_silent[0].treat_missing_data == "breaching"
    error_message = "a sealer that never reports is an alarm, not a quiet day"
  }
  assert {
    condition     = !strcontains(output.relay_policy_json, "Delete") && !strcontains(output.reader_policy_json, "Put")
    error_message = "relays never delete; readers never write"
  }
  assert {
    condition     = !strcontains(aws_iam_role_policy.sealer.policy, "Delete")
    error_message = "the sealer never deletes"
  }
  assert {
    condition     = strcontains(aws_s3_bucket_policy.archive.policy, "s3:BypassGovernanceRetention")
    error_message = "nobody bypasses retention"
  }
}

run "compliance_with_prefix" {
  command = plan

  variables {
    object_lock_mode           = "COMPLIANCE"
    object_lock_retention_days = 30
    archive_prefix             = "tenant-a/"
  }

  assert {
    condition     = aws_s3_bucket_object_lock_configuration.archive.rule[0].default_retention[0].mode == "COMPLIANCE"
    error_message = "the tenant chose COMPLIANCE"
  }
  assert {
    condition     = strcontains(output.relay_policy_json, "/tenant-a/*") && !strcontains(output.relay_policy_json, "//")
    error_message = "policies are scoped to the archive prefix, with the slash normalised"
  }
  assert {
    condition     = output.relay_environment["ARCHIVE_PREFIX"] == "tenant-a/"
    error_message = "relays receive the prefix as given"
  }
}

# The LocalStack stand-in (ADR-0017 §3) skips only what the Community edition cannot represent,
# and nothing about the record: Object Lock stays on, versioning stays on, the sealer and its
# schedule are still deployed. What is skipped is named in the README under "LocalStack".
run "local_stand_in" {
  command = plan

  variables {
    local_stand_in = true
  }

  assert {
    condition     = length(aws_cloudwatch_metric_alarm.sealer_errors) == 0 && length(aws_cloudwatch_metric_alarm.sealer_silent) == 0
    error_message = "the stand-in skips the alarms"
  }
  assert {
    condition     = aws_s3_bucket.archive.object_lock_enabled == true && aws_s3_bucket_object_lock_configuration.archive.rule[0].default_retention[0].mode == "GOVERNANCE"
    error_message = "the stand-in keeps Object Lock and its default retention: LocalStack represents them"
  }
  assert {
    condition     = aws_lambda_function.sealer.runtime == "nodejs22.x" && aws_scheduler_schedule.sealer.schedule_expression == "cron(7 0 * * ? *)"
    error_message = "the stand-in deploys the sealer and its schedule"
  }
}

run "rejects_an_unknown_lock_mode" {
  command = plan

  variables {
    object_lock_mode = "STRICT"
  }

  expect_failures = [var.object_lock_mode]
}
