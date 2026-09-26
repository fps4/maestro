# Module tests with a mocked provider: no account, no credentials. They check the shape ADR-0026
# promises — the standalone server on Node 22 behind the Web Adapter, an HTTP API with one default
# route in front, the tenant's host name only when it comes with its certificate — not whether AWS
# accepts it; the first real tenant proves that (ADR-0017). The layer's ARN is a placeholder: the
# public-repository guards forbid an account id.

mock_provider "aws" {}

variables {
  name                  = "tenant1-console"
  package               = "./tests/fixtures/console.zip"
  web_adapter_layer_arn = "arn:aws:lambda:eu-central-1:aws:layer:LambdaAdapterLayerArm64:25"
  environment           = { API_PROXY_TARGET = "https://specs-api.tenant1.example", PORT = "9999" }
}

run "the_server_behind_the_adapter" {
  command = plan

  assert {
    condition     = aws_lambda_function.console.runtime == "nodejs22.x" && aws_lambda_function.console.handler == "run.sh"
    error_message = "the console runs Next's standalone server from run.sh on Node 22"
  }
  assert {
    condition     = aws_lambda_function.console.layers[0] == var.web_adapter_layer_arn
    error_message = "the Web Adapter layer wraps the runtime"
  }
  assert {
    condition     = aws_lambda_function.console.environment[0].variables["AWS_LAMBDA_EXEC_WRAPPER"] == "/opt/bootstrap"
    error_message = "the adapter is started by the exec wrapper"
  }
  assert {
    condition     = aws_lambda_function.console.environment[0].variables["PORT"] == "8080"
    error_message = "the module owns the port: a tenant's environment does not override it"
  }
  assert {
    condition     = aws_lambda_function.console.environment[0].variables["API_PROXY_TARGET"] == "https://specs-api.tenant1.example"
    error_message = "the tenant's environment reaches the server"
  }
  assert {
    condition     = aws_apigatewayv2_route.default.route_key == "$default"
    error_message = "one default route: the Next server routes"
  }
  assert {
    condition     = length(aws_apigatewayv2_domain_name.console) == 0 && output.domain_target == null
    error_message = "no custom domain unless one is given"
  }
}

run "the_tenants_host_name" {
  command = plan

  variables {
    domain          = "maestro.tenant1.example"
    certificate_arn = "arn:aws:acm:eu-central-1:aws:certificate/placeholder"
  }

  assert {
    condition     = aws_apigatewayv2_domain_name.console[0].domain_name == "maestro.tenant1.example"
    error_message = "the API answers on the tenant's host name"
  }
  assert {
    condition     = aws_apigatewayv2_domain_name.console[0].domain_name_configuration[0].endpoint_type == "REGIONAL"
    error_message = "a regional domain: the certificate is in the deployment's own region"
  }
  assert {
    condition     = length(aws_apigatewayv2_api_mapping.console) == 1
    error_message = "the host name is mapped to the API"
  }
  assert {
    condition     = output.url == "https://maestro.tenant1.example"
    error_message = "the console's url is the tenant's host name"
  }
}

run "a_domain_needs_its_certificate" {
  command = plan
  variables {
    domain = "maestro.tenant1.example"
  }
  expect_failures = [var.certificate_arn]
}

run "the_timeout_the_gateway_allows" {
  command = plan
  variables {
    timeout_seconds = 60
  }
  expect_failures = [var.timeout_seconds]
}
