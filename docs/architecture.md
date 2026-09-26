# Architecture

How the components fit, where the lines are that nothing crosses, what carries the record, and the shape every component has. Figures are in [diagrams.md](diagrams.md).

## 1. The components and what connects them

Every component depends on **identity-service** at runtime and on nothing else. Everything else is a **port with a local default** — the component runs alone — or a **reference by id** that involves no call.

| Component | Required dependency | Ports (local default → AWS adapter) | References by id |
|---|---|---|---|
| [identity-service](components/identity-service.md) | — | database; object storage | — |
| [specs-service](components/specs-service.md) | identity-service | record sink (outbox → relay); evaluator (facet schema → HTTP); notifier (log → the console); object storage (MinIO → S3) | — |
| [work-service](components/work-service.md) | identity-service | record sink; notifier; signals intake (HTTP → SQS from SNS/EventBridge/GitHub); authority resolver (built-in → specs-service gates) | the version an item closes on; the instance it is about; the run discharging it |
| [runtime-service](components/runtime-service.md) | identity-service | record sink; deploy intake (HTTP → EventBridge/SQS); scan intake (ECR/Inspector) | the version an instance realises; the decision that released it |
| [agent-service](components/agent-service.md) | identity-service | record sink; run-event intake (HTTP → runner); transcript store (MinIO → S3) | the item or draft a run is about |
| [the spine](components/spine.md) | — | archive (MinIO → S3); delivery (in-process → SNS/SQS) | — |

**Interfaces.** Every component exposes an HTTP API and an MCP server over its own workspace data, and its screens in the deployment's one console ([ADR-0023](decisions/0023-maestro-alerts-in-its-one-console.md)). There is no MCP gateway: a gateway would be a shared service seeing every tenant's runtime data. `maestro-skills`, the Claude Code plugin, registers all of them per repository.

**What flows where.** Signals arrive at work-service; deploys arrive at runtime-service; run events arrive at agent-service; decisions are made in specs-service. Everything any of them records leaves through its outbox to the spine, and every other component that needs it reads it from there.

## 2. The lines nothing crosses

**Isolation is a property of where data lives, never of a query.** Inside every component a workspace handle is acquired once per request and no query names a workspace. A forgotten filter returns everyone's rows; a forgotten handle has nothing to query. By default a tenant is a deployment ([ADR-0007](decisions/0007-tenant-is-a-deployment-by-default.md)), so the workspace boundary is the second wall, not the first.

**Three planes, never fused.**

| Plane | Holds | Lives in | Never holds |
|---|---|---|---|
| **The record** | attributed events: what was decided, committed, deployed, run | S3 archive via the spine | free text, personal data, telemetry |
| **Application data** | drafts, bodies, notes, transcripts, attachments — classified, retained, erasable | each component's database and S3 prefix | the only copy of a governance fact |
| **Telemetry** | logs, metrics, traces of maestro's own components | CloudWatch | anything an auditor is shown |

A managed cloud tempts you to fuse the first and third (EventBridge for both governance and application events; CloudWatch as an audit log). Fusing either deletes the export.

**Agents never decide.** An agent may draft, propose, claim, act within a ceiling, ask, and answer. A decision at a gate is a human's, recorded with the version's digest, and no MCP tool records one. This is enforced by the interfaces, not by a prompt.

**The accountable human never moves.** Every event, item and run carries `accountable` (a human), `acting` (whoever performed the act), the seat, and the oversight level in force at the time — copied on, never joined to current configuration. Reassignment moves work; it never moves accountability.

## 3. The spine

```
component ──outbox──▶ relay (scheduled Lambda) ──▶ S3 archive ──▶ SNS FIFO ──▶ SQS FIFO per consumer
                                                   (the record)                (message group = workspace)
```

- **The archive is the system of record.** Daily sealed segments per workspace; a Merkle root over canonical JSON (RFC 8785) in sequence order; each segment chained to the previous; the chain computed in code, never by a vendor primitive; Object Lock as defence in depth only.
- **Every component database is a projection.** Rebuild reads the archive from zero. Dropping and rebuilding a workspace is an acceptance scenario for every component (R2).
- **The queue is transport.** Fourteen-day retention is irrelevant once the archive exists. Replay never reads it.
- **Sequence is assigned by the writing service**, per workspace, in the outbox — never derived from a queue or a broker.
- **`export` and `verify` ship with the foundation.** The verifier re-reads segments, recomputes the chain, and returns pass or the first divergent sequence. Any party can run it with every service off.

Full design: [components/spine.md](components/spine.md).

## 4. The shape every component has

Extracted from identity-service and specs-service; work-service, runtime-service and agent-service match it.

| | |
|---|---|
| **One required dependency** | identity-service, for authentication and the principal registry |
| **Ports with local defaults** | record sink, notifier, object storage, evaluator or intake — each runs on a default so the component runs alone on a laptop |
| **Configuration as the domain model** | types, gates, classes, policy, labels are a YAML definition validated at load; no code change to add a type or a clock |
| **A pure domain** | the domain module imports nothing from services or transport; a lint keeps it so |
| **A workspace handle bound once** | the only way to reach a store |
| **A principal registry** | maestro's own ids; identity-provider subjects live only in binding rows |
| **Three interfaces** | console, HTTP API, MCP — same operations, same checks, no bespoke agent plane |
| **A transactional outbox** | every state change emitted with the change, attributed |
| **Export** | the component's part of the record, readable without it |

## 5. Deployment shape

Per tenant, one Terraform root module composing the components' modules:

| Piece | Service |
|---|---|
| APIs | Lambda (Web Adapter) + HTTP API Gateway, one function per component |
| Consoles | OpenNext → Lambda (Function URL behind CloudFront, OAC) + S3 assets — [`console/terraform`](../console/README.md) |
| Relays and clocks | EventBridge Scheduler → Lambda |
| Record | S3 (archive, transcripts, attachments), SNS FIFO, SQS FIFO |
| Database | DynamoDB, one table per component, the module's own ([ADR-0018](decisions/0018-dynamodb-is-the-mvp-database.md)) |
| Identity | identity-service on Lambda, one realm |
| Intake | SQS queues subscribed to tenant applications' `ops-signals` topics; EventBridge bus for deploys and findings |
| Notification | the console's Today ([ADR-0023](decisions/0023-maestro-alerts-in-its-one-console.md)); Slack and email after the MVP |
| Runner | GitHub Actions, GitHub-hosted, under an agent principal |

The root module lives in, and is parameterised by, `fps4/maestro-<tenant>` ([tenancy-and-config.md](tenancy-and-config.md)). Nothing in the public repositories names a tenant.

## 6. Repositories

| Repository | Holds | Earned by |
|---|---|---|
| `fps4/identity-service` | authentication, principal pool, admin plane | every product |
| `fps4/maestro-runtime` | runtime-service | the estate's operations |
| `fps4/maestro-skills` | the Claude Code plugin | every repository in an estate |
| `fps4/maestro` | this design; the components with no consumer outside maestro — the spine, specs-service, work-service, agent-service — released together at one tag ([ADR-0020](decisions/0020-maestros-own-services-live-in-one-repository.md)) | — |
| `fps4/maestro-<tenant>` | one tenant's configuration, private | the tenant |

Across repositories the boundary is the network and the port contract ([ADR-0015](decisions/0015-repositories-and-licence.md)).
