# The console module

A Next.js console on AWS, the way [ADR-0002](../docs/decisions/0002-serverless-aws-is-the-substrate.md)
put it — OpenNext to Lambda and CloudFront — as the Terraform module
[ADR-0016](../docs/decisions/0016-terraform-is-the-infrastructure-language.md) left open: maestro's
own, not the community one. Every component with a console calls it once from the tenant's root:
identity-service's `console/` and specs-service's `web/` today.

```
terraform/            the module; examples/demo is the demo tenant's specs-service console
terraform/edge/       the two edge functions: Host → x-forwarded-host, and the request-body hash
terraform/tests/      mocked-provider tests and a fixture .open-next/ tree
```

## What it deploys

The module reads `open-next.output.json` — what OpenNext says it built — and deploys what a
console needs from it.

| It creates | Notes |
| --- | --- |
| the server function, `<name>-server` | `server-functions/default` from the build, zipped by the module: Node 22, arm64, the handler the build names, buffered (or streaming, if the build says so). Behind a **function URL** that takes signed calls only (`AWS_IAM`); CloudFront signs them through an origin access control of type `lambda`, on behalf of this distribution and nobody else |
| the assets bucket, `assets_bucket_name` | private, versioned, SSE-S3, public access blocked; CloudFront reads it through an origin access control of type `s3`. Every file under the build's assets is an `aws_s3_object` — uploads are inside `plan` and `apply`, and a new build shows as the objects it adds, changes and removes. `_next/**` (content-hashed) is `public, max-age=31536000, immutable`; the console's `public/` files are `public, max-age=0, must-revalidate` |
| the distribution | one origin per function URL, one for the bucket; the path patterns the build lists, in its order (`_next/*` and each `public/` file to the bucket, the rest to the server); HTTPS redirect, HTTP/2 and /3, IPv6, `price_class`; the tenant's domain and certificate when given |
| two edge functions | a CloudFront Function on the viewer request copies `Host` into `x-forwarded-host` (CloudFront rewrites `Host` for a function URL; Next needs the viewer's); a Lambda@Edge function on the origin request, `<name>-signer`, hashes the body into `x-amz-content-sha256` — see [posts](#posts-and-the-signer) |
| the image optimisation function, `<name>-images` | only with `image_optimization = true`: `image-optimization-function` from the build (sharp, arm64, 1536 MB) behind its own function URL, reading source images from the bucket; `_next/image*` routed to it |
| a log group and an alarm | `/aws/lambda/<name>-server` at `log_retention_days`; five errors in five minutes → `alarm_actions` |

The edge holds the hashed assets for a year and **nothing the server says**: the server's cache
policy forwards every cookie, query string and the headers Next routes on (`accept`, `rsc`,
`next-router-prefetch`, `next-router-state-tree`, `next-url`) and has every TTL at zero. Next marks
prerendered pages `s-maxage=31536000`; an edge that honoured it would keep serving the previous
build's page — pointing at chunks the deploy removed — until someone invalidated it. A console has
tens of users; caching its HTML buys nothing, and a deploy that is complete when `apply` is buys a
lot. Compression stays on.

## The build step

A component builds its console in the console's directory; the module takes the result.

```sh
cd web            # or console/
npm ci
NEXT_PUBLIC_IDENTITY_BASE_URL=https://id.<tenant-domain> \
NEXT_PUBLIC_IDENTITY_CLIENT_ID=… \
npx @opennextjs/aws build   # runs `next build`, then writes .open-next/
```

In the tenant pipeline that step is `scripts/checkout-components.sh`
([ADR-0017](../docs/decisions/0017-the-tenant-repository-runs-the-pipeline.md)): each package with a
lockfile gets `npm ci`, `npm run build` and `npm run bundle --if-present`, so a console's
`package.json` carries `"bundle": "open-next build"` with `@opennextjs/aws` as a devDependency, the
`NEXT_PUBLIC_*` values sit in the job's environment, and the root points `open_next_dir` at
`components/<component>/<console>/.open-next`.

Two things about that step:

- **`NEXT_PUBLIC_*` is baked at build.** Next inlines those variables into the browser bundle;
  the module never sees them. They are set in the environment of the build, per tenant, after the
  issuer and the API's addresses are known. What the server reads at request time — the API it
  proxies to, a break-glass token — goes through the module's `environment` and `secrets`.
- **Say what the console is.** OpenNext's default build expects an S3 incremental cache, a DynamoDB
  tag cache and an SQS revalidation queue, none of which this module creates. Such a build serves
  — the console's pages are dynamic — and logs a failed cache lookup on every prerendered page.
  A console with no ISR carries an `open-next.config.ts` that says so, and the build then produces
  neither a `cache/` directory nor the DynamoDB seeder:

  ```ts
  // open-next.config.ts — a console: server-rendered, no ISR, no tag cache
  const config = {
    default: {},
    dangerous: { disableIncrementalCache: true, disableTagCache: true },
  };
  export default config;
  ```

  The module checks `open-next.output.json` for this and warns on every plan when it is missing
  (`check "built_for_ssr"`).

The build is not reproducible — `next build` assigns a fresh build id, and the hashed chunks move
with it — so every build is a deploy. The zip *is*: the module packages the function directory with
sorted entries and fixed timestamps, so the same tree gives the same hash on a laptop and on the
runner, and a plan against an unchanged tree changes nothing. Bundling stays OpenNext's; this is
packaging for Lambda. A server package over 50 MB zipped needs the S3 upload path; neither console
is near it (identity-service's is 6 MB).

## Inputs and outputs

| Input | Default | Meaning |
| --- | --- | --- |
| `name` | — | prefix for every named resource, e.g. `maestro-specs-console` |
| `open_next_dir` | — | the `.open-next/` the build wrote; absolute, or built from the root's `path.module` |
| `assets_bucket_name` | — | globally unique; the tenant's to choose |
| `environment` | `{}` | server-side variables, read at request time |
| `secrets` | `{}` | variable → Secrets Manager ARN, read at plan and set on the function. The value is in the state, which the state bucket protects ([ADR-0017](../docs/decisions/0017-the-tenant-repository-runs-the-pipeline.md)); reading at boot through the Parameters and Secrets extension is the follow-up |
| `domain`, `certificate_arn` | `null` | the console's host name and its ACM certificate — which CloudFront reads from **us-east-1 only**; validated |
| `price_class` | `PriceClass_100` | which edges serve it |
| `memory_mb`, `timeout_seconds` | 1024, 10 | the server function; the timeout is capped at 60, CloudFront's ceiling |
| `log_retention_days` | 90 | |
| `image_optimization` | `false` | deploy the image optimiser and route `_next/image*` to it. Off, a console that uses `next/image` must set `images.unoptimized`, or its images 404 |
| `alarm_actions` | `[]` | the tenant's ops-signals topic, once work-service listens |
| `tags` | `{}` | `maestro:console = <name>` is added |

| Output | Meaning |
| --- | --- |
| `url` | `https://<domain>`, or the distribution's own name |
| `distribution_id`, `distribution_domain_name`, `distribution_hosted_zone_id` | for the root's DNS: a Route 53 alias or a CNAME from `domain` to the distribution |
| `assets_bucket_name`, `server_function_name`, `images_function_name` | the names; `images_function_name` is null when the optimiser is off |

### The `aws.us_east_1` configuration

CloudFront reads certificates from us-east-1 and Lambda@Edge runs from there, whatever the
deployment's region. The module declares `configuration_aliases = [aws.us_east_1]` and the root
passes both:

```hcl
provider "aws" { region = "eu-west-1" }
provider "aws" { alias = "us_east_1", region = "us-east-1" }

module "specs_console" {
  source    = "github.com/fps4/maestro//console/terraform?ref=<tag>"
  providers = { aws = aws, aws.us_east_1 = aws.us_east_1 }

  name               = "maestro-specs-console"
  open_next_dir      = "${path.module}/../../maestro-specs/web/.open-next"
  assets_bucket_name = var.specs_console_assets_bucket
  environment        = { API_PROXY_TARGET = module.specs.api_url }
  domain             = "specs.${var.domain}"
  certificate_arn    = aws_acm_certificate.specs.arn   # provider = aws.us_east_1
}
```

[`examples/demo/main.tf`](terraform/examples/demo/main.tf) is the whole of it with placeholders.
Terraform ≥ 1.6, providers `aws` ≥ 5.80 and `archive` ≥ 2.4; runs on OpenTofu unchanged.

```sh
cd terraform && terraform init -backend=false && terraform test   # mocked providers; Terraform ≥ 1.11
```

`terraform validate` in the module's directory reports the alias as a missing provider — a module
with `configuration_aliases` validates through a root that passes them; CI validates the example.

## Posts and the signer

CloudFront's origin access control signs what it sends to the function URL (SigV4) but does not
hash the body, and Lambda refuses an unsigned payload: a `POST` through a bare OAC is a 403. That
is every form post and every server action a console makes. The AWS documentation's answer is that
the viewer computes `x-amz-content-sha256`; a browser will not. So the module puts a Lambda@Edge
function on the origin request with the body included — twenty lines, `edge/signer.js` — that
hashes what CloudFront left out. It runs on every request that reaches the server, does nothing for
a `GET`, and answers 413 to a body over the 1 MB CloudFront exposes to it rather than let the origin
refuse the hash of a truncated one.

What that costs and constrains: one Lambda@Edge invocation per server request (fractions of a
cent per ten thousand); x86_64, no environment, a published version, us-east-1; logs land in the
region that ran it under `/aws/lambda/us-east-1.<name>-signer`, which is why its role may create
log groups and why those groups have no retention set; and a `destroy` may need a second run some
minutes later, while AWS removes the replicas from the edge.

The alternatives were a public function URL (the URL is guessable and bypasses CloudFront) or an
HTTP API in front of the function (a public endpoint again, and one more resource that is not the
recommendation). A tenant with a hard reason to avoid Lambda@Edge takes the second; the module does
not offer it until someone does.

## What is out, and why

| Not deployed | Why |
| --- | --- |
| the revalidation queue and function, the tag cache table and its seeder | ISR and `revalidateTag`: the consoles render on request and cache nothing. Added when a console needs it — then the queue is SQS FIFO, the cache is DynamoDB, and the server's role and environment gain both |
| the incremental cache (`_cache/` in the bucket) | the same; a build made without `disableIncrementalCache` lists it, and the module skips it |
| the warmer | a scheduled function that invokes the server to keep it warm. A console's users are few; a cold start is a second |
| edge caching of the server's responses | above: no invalidation step, no stale page after a deploy |
| an alarm on the image function, a WAF, access logs | when a tenant asks |

## What a real account proves

The tests check the shape, not AWS's acceptance ([ADR-0017](../docs/decisions/0017-the-tenant-repository-runs-the-pipeline.md):
the first tenant proves a module). Against a real account, watch: the server cache policy with all
TTLs at zero **and** cache-key parameters (the managed `CachingDisabled` policy carries none — if
CloudFront rejects the combination, `max_ttl = 1` is the fallback); the OAC on a function URL with
the two permissions the documentation names; the signer's hash being accepted for a server action;
Lambda@Edge on `nodejs22.x`. The module was planned against identity-service's real `.open-next/`
(OpenNext 4.1.5, Next 15.5): 29 assets, four ordered behaviours, 51 resources, 59 with the image
optimiser.
