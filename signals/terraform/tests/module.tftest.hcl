# Module tests with a mocked provider: no account, no credentials. What they check is the shape
# the contract promises (docs/signals.md) — the topic's name, who its policy admits, the three
# tags, a heartbeat that can be switched off, a silence alarm that treats no data as breaching —
# not whether AWS accepts it. That is proven by the first application onboarded at N1.

# Terraform >= 1.11 (override_during). ARNs are mocked without an account: the public-repository
# guards forbid one, and the policies only need the shape.
mock_provider "aws" {
  mock_data "aws_partition" {
    defaults = {
      partition = "aws"
    }
  }
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "this-account"
    }
  }
  mock_resource "aws_sns_topic" {
    override_during = plan
    defaults = {
      arn = "arn:aws:sns:eu-west-1::app1-production-ops-signals"
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
  application = "app1"
  environment = "production"
  tier        = "tier1"
  # Twelve zeros, computed rather than written: the guard in scripts/check-public.sh refuses a
  # twelve-digit literal on any line that also says "account", and nothing here needs one.
  maestro_account_id = format("%012d", 0)
}

run "defaults" {
  command = plan

  assert {
    condition     = aws_sns_topic.ops_signals.name == "app1-production-ops-signals"
    error_message = "the topic is <application>-<environment>-ops-signals"
  }
  assert {
    condition     = strcontains(aws_sns_topic_policy.ops_signals.policy, "cloudwatch.amazonaws.com")
    error_message = "CloudWatch alarms in this account publish to the topic"
  }
  assert {
    condition     = strcontains(aws_sns_topic_policy.ops_signals.policy, "\"aws:SourceAccount\":\"this-account\"")
    error_message = "CloudWatch's grant is conditioned on this account, not any account"
  }
  assert {
    condition     = strcontains(aws_sns_topic_policy.ops_signals.policy, "sns:Subscribe")
    error_message = "subscribing is granted"
  }
  assert {
    condition     = strcontains(aws_sns_topic_policy.ops_signals.policy, ":iam::${var.maestro_account_id}:root")
    error_message = "the maestro account is the cross-account principal the policy admits"
  }
  assert {
    condition     = strcontains(aws_sns_topic_policy.ops_signals.policy, ":iam::this-account:root")
    error_message = "anything in this account may subscribe too: the topic is the application's public ops interface"
  }
  assert {
    condition     = !strcontains(aws_sns_topic_policy.ops_signals.policy, "\"Principal\":\"*\"")
    error_message = "the policy names its principals; nothing is granted to everyone"
  }
  assert {
    condition = (
      aws_sns_topic.ops_signals.tags["maestro:application"] == "app1" &&
      aws_sns_topic.ops_signals.tags["maestro:environment"] == "production" &&
      aws_sns_topic.ops_signals.tags["maestro:tier"] == "tier1"
    )
    error_message = "the topic carries the three maestro tags"
  }
  assert {
    condition     = output.tags == { "maestro:application" = "app1", "maestro:environment" = "production", "maestro:tier" = "tier1" }
    error_message = "the tags output is the schema, and nothing else, when nothing else was given"
  }
  assert {
    condition     = output.alarm_actions == [aws_sns_topic.ops_signals.arn] && output.ok_actions == [aws_sns_topic.ops_signals.arn]
    error_message = "alarm_actions and ok_actions are the topic, as a list an alarm takes as is"
  }
  assert {
    condition     = length(aws_lambda_function.heartbeat) == 1 && length(aws_scheduler_schedule.heartbeat) == 1 && length(aws_cloudwatch_metric_alarm.silence) == 1
    error_message = "the heartbeat is on by default"
  }
  assert {
    condition     = aws_lambda_function.heartbeat[0].runtime == "nodejs22.x" && aws_lambda_function.heartbeat[0].architectures == tolist(["arm64"]) && aws_lambda_function.heartbeat[0].handler == "index.handler"
    error_message = "the heartbeat runs on Node 22, arm64"
  }
  assert {
    condition     = aws_lambda_function.heartbeat[0].environment[0].variables["APPLICATION"] == "app1" && aws_lambda_function.heartbeat[0].environment[0].variables["ENVIRONMENT"] == "production"
    error_message = "the heartbeat's dimensions come from its environment"
  }
  assert {
    condition     = strcontains(aws_iam_role_policy.heartbeat[0].policy, "cloudwatch:PutMetricData") && strcontains(aws_iam_role_policy.heartbeat[0].policy, "maestro/heartbeat")
    error_message = "the heartbeat may put a metric in its own namespace"
  }
  assert {
    condition     = !strcontains(aws_iam_role_policy.heartbeat[0].policy, "logs:") && !strcontains(aws_iam_role_policy.heartbeat[0].policy, "sns:")
    error_message = "and nothing else"
  }
  assert {
    condition     = aws_scheduler_schedule.heartbeat[0].schedule_expression == "rate(5 minutes)"
    error_message = "one beat every five minutes"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.silence[0].alarm_name == "app1-production-silence"
    error_message = "the silence alarm is <application>-<environment>-silence"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.silence[0].treat_missing_data == "breaching"
    error_message = "no heartbeat at all is silence, not a quiet period"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.silence[0].period == 900 && aws_cloudwatch_metric_alarm.silence[0].comparison_operator == "LessThanThreshold" && aws_cloudwatch_metric_alarm.silence[0].threshold == 1
    error_message = "fewer than one beat in fifteen minutes is silence"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.silence[0].namespace == "maestro/heartbeat" && aws_cloudwatch_metric_alarm.silence[0].metric_name == "Heartbeat" && aws_cloudwatch_metric_alarm.silence[0].dimensions == tomap({ application = "app1", environment = "production" })
    error_message = "the alarm watches the metric the heartbeat puts"
  }
  assert {
    condition     = aws_cloudwatch_metric_alarm.silence[0].alarm_actions == toset([aws_sns_topic.ops_signals.arn]) && aws_cloudwatch_metric_alarm.silence[0].ok_actions == toset([aws_sns_topic.ops_signals.arn])
    error_message = "silence and its end both reach the topic"
  }
  assert {
    condition     = output.heartbeat_metric.namespace == "maestro/heartbeat" && output.heartbeat_metric.name == "Heartbeat" && output.heartbeat_metric.dimensions["application"] == "app1"
    error_message = "heartbeat_metric says where the heartbeat lands"
  }
}

run "without_heartbeat" {
  command = plan

  variables {
    heartbeat = false
  }

  assert {
    condition     = length(aws_lambda_function.heartbeat) == 0 && length(aws_iam_role.heartbeat) == 0 && length(aws_scheduler_schedule.heartbeat) == 0 && length(aws_cloudwatch_metric_alarm.silence) == 0
    error_message = "heartbeat = false creates no function, role, schedule or alarm"
  }
  assert {
    condition     = output.heartbeat_metric == null
    error_message = "no heartbeat, no metric to name"
  }
  assert {
    condition     = aws_sns_topic.ops_signals.name == "app1-production-ops-signals"
    error_message = "the topic is there regardless"
  }
}

run "application_tags_pass_through_and_the_schema_wins" {
  command = plan

  variables {
    tags = { "cost-centre" = "app1", "maestro:application" = "not-app1" }
  }

  assert {
    condition     = output.tags["cost-centre"] == "app1"
    error_message = "the application's own tags pass through"
  }
  assert {
    condition     = output.tags["maestro:application"] == "app1" && aws_sns_topic.ops_signals.tags["maestro:application"] == "app1"
    error_message = "the schema's values are the module's, not the caller's"
  }
}

run "rejects_an_account_id_that_is_not_twelve_digits" {
  command = plan

  variables {
    maestro_account_id = "12345"
  }

  expect_failures = [var.maestro_account_id]
}

run "rejects_an_application_name_that_is_not_a_token" {
  command = plan

  variables {
    application = "App 1"
  }

  expect_failures = [var.application]
}
