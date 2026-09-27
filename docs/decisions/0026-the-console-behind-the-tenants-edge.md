# ADR-0026 · The console runs like an API, behind the tenant's own edge

**Status:** accepted · 2026-09-27 (proposed 2026-09-26) · amends [ADR-0002](0002-serverless-aws-is-the-substrate.md) (its clause on consoles: "OpenNext and CloudFront")

## Context

[ADR-0002](0002-serverless-aws-is-the-substrate.md) put the consoles on OpenNext and CloudFront. The console module built for that ([`console/terraform`](../../console/README.md)) had never deployed a console when the first tenant came to put one at its own host name. The tenant already puts every host name of its own behind Cloudflare, which terminates TLS, caches, and protects.

CloudFront behind Cloudflare is a second CDN behind the first, and it carried the module's hardest parts:
- a certificate and a Lambda@Edge function in us-east-1, and a second provider configuration for them;
- a Lambda@Edge "signer", which exists only because CloudFront's origin access control leaves a request body unhashed and Lambda's function URL then refuses the POST;
- an assets bucket, and a CloudFront Function copying `Host`.

Every maestro API already runs as one Lambda behind the Web Adapter, with an HTTP API in front.

## Decision

1. **A console is Next's standalone server on Lambda behind the Web Adapter, with an HTTP API in front**, like every maestro API. The server serves its own static files. `npm run build && npm run bundle` in `console/web` writes `bundle/console.zip`, and [`console/terraform`](../../console/README.md) deploys it.
2. **The tenant's host name is a custom domain on that HTTP API**, with an ACM certificate in the deployment's own region. The tenant validates the certificate with a DNS record where its zone is, and points a CNAME at the API's domain target.
3. **The edge is the tenant's.** Cloudflare, or whatever CDN a tenant runs, proxies the host name to the API with TLS verified end to end ("Full (strict)"), and caches `/_next/static/*`, which Next marks `immutable`. maestro deploys no CDN.
4. **Build-time settings come from the tenant pipeline's `build_env`.** Next bakes `NEXT_PUBLIC_*` into the browser bundle, so the tenant names them in the workflow that builds.

## Consequences

- The module loses CloudFront, both edge functions, the assets bucket, the us-east-1 provider and OpenNext. It gains a custom domain, and the tenant gains one DNS record to validate the certificate and one CNAME.
- A request for a static file that the edge has not cached is a Lambda invocation. A console's users are few, and the edge holds the hashed files for a year.
- An HTTP API gives the console 30 seconds per request and a 10 MB body, which is more than a console asks for.
- Without an edge in front, a console still answers on the API's execute-api name, with AWS's TLS. That is enough for a laptop or a check.
- identity-service's admin console moves to the same shape when it is deployed from the tenant repository.

## What would reopen it

A tenant with no CDN of its own that wants one managed by maestro, or a console that needs ISR or large uploads. Either brings a CDN back into the module, as an option rather than the default.
