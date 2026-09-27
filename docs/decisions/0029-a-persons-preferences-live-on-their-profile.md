# ADR-0029 · A person's preferences live on their profile in identity-service

**Status:** proposed · 2026-09-27 · follows [ADR-0023](0023-maestro-alerts-in-its-one-console.md) (one console, holding no data of its own); asks a small capability of identity-service

## Context

[ux.md](../ux.md) rule 10: the register and the frontier filter by application and milestone, and by *mine · held by agents · unclaimed*, and **preferences persist per person**. The console's filters are links today, so a filtered view is a URL a person can keep. Nothing remembers the view they last chose.

Nothing in maestro holds anything about a person beyond their principal id:

- **The console** holds no data of its own ([ADR-0023](0023-maestro-alerts-in-its-one-console.md)).
- **identity-service** has no profile endpoint.

The architect decided on 2026-09-27 that preferences are stored on the person's profile, in a DynamoDB table.

## Decision

### 1. identity-service keeps a preferences document per person per application

identity-service owns the person, so it owns their profile. It gains two operations, called with the person's own token and for that person only:

| Operation | Does |
|---|---|
| `GET /v1/me/preferences/<application>` | the document, or `{}` |
| `PUT /v1/me/preferences/<application>` | replaces it: a JSON object of at most 8 KB, written with the token's subject and the time |

- **Keyed and namespaced.** The document is keyed by the person (the token's `sub` in the realm) and by the application id (`maestro`). Each application keeps its own and cannot read another's.
- **Stored in identity-service's own table**, beside the user, and never in the token.
- **Not in the admin console.** It is not an administrator's to see or change.

### 2. Preferences decide what a person sees first, never what they may see or do

- **Nothing authorises by a preference.** A service never reads one.
- **A lost preference costs a click:** the console falls back to its defaults.
- **The URL still wins.** A filtered view is still a link, and a link with its filters in it is shown as it says.
- **What is remembered is the last choice.** Nothing is inferred.

### 3. The console reads and writes them server-side

- **Where the calls come from.** The console calls identity-service from its server with the person's token, as it calls every component.
- **Reading.** A page opened with no filters in its URL reads the person's last choice from the document.
- **Writing.** A filter chosen is written back.
- **The document** is `{ "console": { "owed": { "who": …, "application": … }, "board": { "application": … } } }`. The console owns its shape; identity-service stores it without reading it.

## Asked

1. **Namespaced per application** (`/v1/me/preferences/maestro`) rather than one document per person.
   - *Recommended:* per application. Other applications sign in through the same realm, and one application's settings are nothing to another.
2. **The size limit.**
   - *Recommended:* 8 KB per document. Filters and pins are small; anything larger is data, not a preference.

## Consequences

- identity-service grows a small, self-contained capability, in its own repository, merged on the architect's word. It has two routes, one item kind in its table, and tests.
- The console remembers the Owed and board filters per person, on any browser they sign in from.
- Pins and other preferences later need no new store.

## What would reopen it

A preference that has to be shared by a team, or that a service must act on. That is configuration or record, not a preference, and it belongs in a component's definition.
