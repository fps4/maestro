# The console module

A Next.js console on AWS, run the way every maestro API runs ([ADR-0026](../docs/decisions/0026-the-console-behind-the-tenants-edge.md)):
Next's standalone server on Lambda behind the [Web Adapter](https://github.com/awslabs/aws-lambda-web-adapter),
an HTTP API in front of it, and the tenant's host name on that API. The edge in front of the host
name (TLS to the browser, caching, protection) is the tenant's own CDN, Cloudflare for the first
tenant. maestro deploys none.

```
web/                  the console (ADR-0023: one per deployment)
terraform/            the module; examples/demo is the demo tenant's console
terraform/tests/      mocked-provider tests and a fixture zip
infra/docker/         the image CI builds as the console's gate
```

## What it deploys

| It creates | Notes |
| --- | --- |
| the function, `<name>` | `bundle/console.zip`: Node 22, arm64, handler `run.sh` (`exec node server.js`), the Web Adapter layer, `PORT=8080` |
| the HTTP API, `<name>` | one `$default` route to the function; access logs to `/aws/apigateway/<name>` |
| the host name | only with `domain` **and** `certificate_arn`: a regional custom domain on the API, and its mapping |
| a log group and an alarm | `/aws/lambda/<name>` at `log_retention_days`; five 5xx in five minutes → `alarm_actions` |

The function's role may write its own log and nothing else. The console holds no data: it reads each
component's API with the signed-in person's token, which lives in an httpOnly cookie and never reaches
the browser's code.

## The build

```sh
cd web
npm ci
NEXT_PUBLIC_AUTH_MODE=component-auth \
NEXT_PUBLIC_IDENTITY_BASE_URL=<issuer> NEXT_PUBLIC_IDENTITY_CLIENT_ID=maestro-web \
NEXT_PUBLIC_DEFAULT_WORKSPACE=<workspace> \
npm run build && npm run bundle        # → bundle/console.zip
```

`NEXT_PUBLIC_*` is baked in at the build, so the module never sees it. In the tenant pipeline the
build is `scripts/checkout-components.sh`, and the values come from the caller's `build_env`
([`tenant-deploy.yml`](../.github/workflows/tenant-deploy.yml)). What the server reads at request
time, such as the API it proxies to, goes through the module's `environment`.

The zip is packaged with sorted entries and fixed times. `next build` assigns a fresh build id, so
every build is still a deploy.

## The host name, step by step

1. The root issues an ACM certificate for the host name **in the deployment's own region**
   (`validation_method = "DNS"`) and outputs its validation record.
2. The tenant adds that record in its DNS (Cloudflare: *DNS only*) and waits for the certificate to
   be `ISSUED`.
3. The root passes `domain` and `certificate_arn`; the module outputs `domain_target`.
4. The tenant points a CNAME for the host name at `domain_target`. In Cloudflare that is *proxied*,
   with SSL/TLS **Full (strict)**: the API presents the certificate for the host name, so the edge
   verifies it.

## Inputs and outputs

| Input | Default | Meaning |
| --- | --- | --- |
| `name` | — | the function's and the API's name, e.g. `tenant1-console` |
| `package` | — | `bundle/console.zip` |
| `web_adapter_layer_arn` | — | the Web Adapter layer for the region, arm64 |
| `environment` | `{}` | server-side variables, e.g. `API_PROXY_TARGET`. The module's own (`PORT`, the adapter) cannot be overridden |
| `secrets` | `{}` | variable → Secrets Manager ARN, read at plan and set on the function |
| `domain`, `certificate_arn` | `null` | the host name and its **issued**, regional certificate: both or neither |
| `memory_mb`, `timeout_seconds` | 1024, 29 | the timeout is capped at 30, the HTTP API's |
| `log_retention_days` | 90 | |
| `alarm_actions` | `[]` | |
| `tags` | `{}` | `maestro:console = <name>` is added |

| Output | Meaning |
| --- | --- |
| `url` | `https://<domain>`, or the API's execute-api name |
| `api_endpoint` | the execute-api name, for checks |
| `domain_target`, `domain_hosted_zone_id` | where the host name's CNAME (or Route 53 alias) points; null without a domain |
| `function_name` | |

```sh
cd terraform && terraform init -backend=false && terraform test   # mocked provider
```
