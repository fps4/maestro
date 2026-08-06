---
title: The console ships with the password grant; PKCE is the follow-up
status: proposed
date: 2026-08-06
deciders: [architect]
related:
  - ./0002-identity-service-is-the-only-dependency.md
---

# ADR-0011 — The console ships with the password grant, and PKCE is the follow-up

## Context

The architecture specifies **authorization code + PKCE** for the console, and gives a concrete
reason: a user already signed in for another Application in the same identity deployment should
reach this console **without seeing a login form**. That transparent SSO is the property the shared
user pool exists to provide.

The identity deployment on this estate has a proven, in-production password-grant integration behind
an httpOnly cookie session with a rotating refresh token. The authorization-code endpoints and the
redirect-URI registration for a new Application are not verified here.

## Decision

**Ship the password grant first, and record that the SSO property does not hold.**

The console posts credentials to identity-service, stores the access token in an **httpOnly** cookie
the browser cannot read, and reaches the api through a route handler that turns that cookie into an
`Authorization` header — which is why it is a handler rather than a Next rewrite.

**PKCE is the follow-up, and it is a follow-up rather than a maybe.**

## Consequences

**The stated benefit of being an Application in a shared identity deployment is not delivered yet.**
A user signed in for another product still sees a login form here. That is a real gap against the
architecture, written down in three places — here, in `config/ds1/.env.base`, and in `lib/auth.ts` —
rather than discovered by someone wondering why SSO does not work.

**This console handles a password.** With the authorization-code flow it never would. The mitigation
is that it is posted directly to identity-service and never stored; the honest statement is that the
attack surface is larger than the design intends, for as long as this is in place.

**Nothing downstream changes when PKCE lands.** The session is already an httpOnly cookie and the
api already verifies a bearer token against JWKS. The swap is confined to `lib/auth.ts` and a
redirect route.

## Alternatives considered

**Build PKCE now.** Correct by the architecture. Rejected for this pull request only: it needs
identity-service configuration this repository cannot verify, and shipping an unverified auth flow
to reach a stated SSO property is a worse trade than shipping a proven one and naming the gap.

**Ship with `AUTH_MODE=dev`.** Refused by `loadConfig` in production, and rightly: a stub principal
is not a degraded mode of authentication, it is the absence of it.
