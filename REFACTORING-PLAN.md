# Refactoring plan — from the design corpus to the MVP docs

**Created:** 2026-09-18 · **Rulings taken:** 2026-09-18, all ten (§2) · **Branch:** `refactor/mvp-docs` · **Owner:** the architect
**How to use:** feed this file to a fresh session. §0 is everything a session needs to know, §2 holds the rulings, §3 is the target tree and what each document says, §4 is the ordered work with checkboxes. Tick boxes as work lands. This file is deleted in the last PR of the refactor. **Phase 1 may start immediately.**

---

## 0. Context — what changed, in one page

`fps4/maestro` today is a design corpus only (`docs/`, twelve documents, ~900 KB) describing a **governed application platform**: sixteen platform services, seven archetype engines, generation from specification to code, a standards layer for regulated domains. Two components exist as code in sibling repositories: `../identity-service` (built, public, MIT) and `../maestro-specs` (specs-service, built, private, no licence).

Between 2026-09-15 and 2026-09-18 the direction was reviewed and changed. **The ruling on the corpus is: purge, not trim.** The new `docs/` is written greenfield for the MVP; the corpus goes to git history behind a tag, so nothing stale is carried into an agent's context. What the MVP needs from the corpus is *re-derived and rewritten*, never moved.

**What maestro is now — the MVP:** an **ops engine** for running applications, made of independently usable components:

| Component | Holds | Status |
|---|---|---|
| identity-service | principals (human, agent, workload), realms, delegated administration | built |
| specs-service | artifacts, drafts/versions, gates, decisions, questions | built; rebuilt for access 2026-09-15 (`../maestro-specs` ADR-0012–0018) |
| work-service | commitments: work items in six classes, authority at claim, clocks from policy, signals intake, board | next |
| runtime-service (the instance register) | what artifact is deployed where, at which tier and onboarding level; fed by deploy events | next |
| agent-service (record half) | runs, steps, transcripts; the runner is GitHub Actions + Claude Code under an agent principal | next |
| the spine | S3 archive (system of record) + SNS/SQS delivery; relay from each component's outbox | next, first |

**Out of the MVP:** composition plane, archetype engines, generated applications, execution of instances by the platform, marketplace, standards tiers and packs, and — decided 2026-09-18 — **the Slack intake agent (was phase E)** and **customer-facing tenants (was phase F)**. Both are a post-MVP backlog, not planned. The regulated domain is **branch R**: not built, four seams kept open (§0.3).

**Substrate:** serverless AWS. Lambda (Web Adapter) + API Gateway per component, OpenNext consoles, scheduled Lambdas for relays and clocks, CDK, GitHub-hosted runners. `docker compose` is the local development loop only. ds1's runner pool and `deploy-ds1` retire for these repositories.

**The spine:** each component's transactional outbox → a scheduled relay → an **S3 archive** (the system of record; Merkle chain computed in code; Object Lock as defence in depth) → **SNS FIFO → SQS FIFO** per consumer (message group = workspace). Replay reads the archive, never the queue. Kafka and RabbitMQ are not adopted. The archive relay ships before any consumer.

**Exit narrows to the export:** with no hosted applications there is nothing to hand over but the record — the archive and its verifier, readable with every service off. The old "no proprietary primitive anywhere" rule is dropped; "no service names its substrate" stays, and is what keeps a move cheap.

**Tenancy:** tenant = deployment by default — one CDK stack, one identity realm, one archive prefix per tenant — because serverless removes the cost floor. Shared-service multi-tenancy remains possible (workspace isolation exists in every component) but is not the default. No record stores an identity provider's subject; that is what keeps the choice reversible.

**Identity:** stays identity-service, not Cognito — agent principals and delegated administration were the reasons.

**Database:** MongoDB Atlas Flex (ruled 2026-09-18). Zero code change; DynamoDB stays a deliberate later step if single-vendor comes to matter.

**First real application: app1** (a placeholder throughout the docs; the real name and repository are the tenant's and never appear in a maestro repository): serverless on AWS, infrastructure as code, configuration by PR under CODEOWNERS, a drift-detection workflow, its own failure monitor (P1–P4 → Slack). It runs OpenSpec; ADR-0018's interoperation shape is post-MVP unless use case 1 needs it.

### 0.1 Where the reasoning lives

- Decided architecture, drawn: <https://claude.ai/artifact/LFgeQvyzd6U7QE1nw54n7J>
- The AWS alternative and the three challenges answered: <https://claude.ai/artifact/4V6ndYr9XKf9kKGgs64cbD>
- Use cases, gaps G1–G16, corrections, roadmap: <https://claude.ai/artifact/VwPufkoNqU463Q3ccMckRC>
- UX canvas for specs-service and work-service: <https://claude.ai/artifact/J6CRSQubFoQfpFrBNq6siX>
- `../maestro-specs/docs/design/decisions/0012` … `0018`
- The retired corpus: git tag `corpus-2026-09` on this repository (created in phase 1, §4). Cite it when a new document derives something from it; never link into it from running text.

### 0.2 The MVP roadmap

| Milestone | Builds | Gate |
|---|---|---|
| **M1 · Foundation on AWS** | CDK for identity-service and specs-service; Atlas Flex; S3 archive relay + SNS/SQS; GitHub-hosted CI; the signals contract module (§0.4) | specs-service serves from AWS; a workspace database is dropped and rebuilt from the archive alone; the verifier checks the chain with the service off |
| **M2 · work-service v1** | envelope, six classes, policy (severity × tier → clocks, ceilings, chase), authority at claim, evidence plans, signals intake, Slack/SES adapters, board (milestone, application), MCP with mattpocock's tracker contract as acceptance test, "Today" | the advisory lane end to end without an agent; a patch-class claim on an N1 app refused and counted; medium/low findings fold into one weekly obligation |
| **M3 · Agent runs** | agent-service record half, run-event contract, GitHub Actions runner under an agent principal, transcript custody, run page, sampling queue | a red bump is fixed by a `bump` run with every step and the next human touchpoint visible; a green patch-level bump on an N2 app merges under the agent's ceiling |
| **M4 · Use case 1 on app1** | signals from app1's topic; `cause_analysis` type and gate; RCA and fix runs; register fed by EventBridge deploys; evidence from events; app1 onboarded at N2 | an injected staging failure becomes a SEV item, an accepted analysis, a merged fix, a closed item — a person at three gates only |
| *post-MVP* | Slack intake agent (G10–G13); customer-facing tenants, external readers, per-tenant CDK as a product (G14–G16) | — |
| *branch R* | packs, standards engine, assurance, classification enforced, conformance dossier | forks after M4 |

### 0.3 Seams the MVP keeps open for branch R

1. The archive is the only record — no state that exists nowhere else.
2. Every write attributed; every decision names a human.
3. `consequence_class` on every work item and instance, even while nothing reads it.
4. Classification on every payload and transcript, even while retention is generous.

### 0.4 The signals contract — what the application owns, what maestro owns

Ruled 2026-09-18 (Q10). **Detection lives where the knowledge lives; response lives where the record lives.**

| The application side (app1 or any client app, in its own IaC) | The maestro side |
|---|---|
| CloudWatch alarms: thresholds, periods, composite alarms, anomaly detectors — the team that owns the SLO owns the alarm | Subscribe to the topic (cross-account SQS); normalise to the `signal` envelope |
| DLQ depth, error-rate and latency alarms on its own functions and queues | Dedup by `fingerprint` within a window; correlate a storm into one item |
| Its own failure monitor publishing to the topic with a P-hint | Severity from **policy**: the app's hint × the app's tier/N-level → SEV1–4; maestro may raise or lower, and records why |
| **One SNS topic per application per environment — `ops-signals` — the app's public ops interface.** Alarm actions and OK actions target it; the subscription policy allows the maestro account. Anything else may subscribe too (Chatbot, email, PagerDuty) | Clocks, chase ladders, ceilings, evidence plans — the work item |
| Resource tags `maestro:application`, `maestro:environment`, `maestro:tier` so a signal identifies its instance without a lookup | Routing to humans (Slack, SES) **once it is an item**, with the item link — one alert, one owner: once maestro subscribes, the app's direct Slack alert for the same signal is retired |
| Deploy events to EventBridge from the pipeline (artifact digest, environment, commit, actor) — feeds the instance register | What the app cannot see about itself: **silence** (heartbeat expired), estate-wide drift, GitHub/Dependabot advisories, ECR/Inspector findings, cross-account patterns |
| Maintenance windows declared on the app's own resources? — **no:** declared in maestro, because maestro is what pages | Suppression, maintenance windows, escalation policy, which signal kind maps to which run |

Maestro ships the application-side half as a **Terraform module** (and a CDK construct) in the public repository: the topic, its subscription policy for the maestro account, the tag schema, and an alarm-action helper. Onboarding at N1 = the module applied and maestro subscribed, observe only; N2 = agents may act under ceilings. EventBridge is used for AWS-native state (deploys, findings); SNS for the app's own signals. Both land in the same intake.

The `signal` envelope (owned by maestro, versioned):

```yaml
signal_version: 1
source: cloudwatch-alarm | app-monitor | eventbridge | github | maestro-drift | maestro-heartbeat
application: app1           # from the tag or the topic
environment: production
kind: alarm_state | dlq | error_rate | latency | deploy | advisory | finding | drift | silence
state: alarm | ok           # OK actions close or downgrade
severity_hint: P2           # the app's opinion; policy decides
fingerprint: app1/prod/api/ErrorRate          # dedup key
resource: arn:aws:lambda:…:function:app1-api
occurred_at: 2026-09-18T08:12:00Z
link: https://console.aws.amazon.com/…
detail: {}                  # source-specific, classified
```

### 0.5 Repositories and visibility

| Repository | Holds | Today | Intended |
|---|---|---|---|
| `fps4/maestro` | the MVP docs; later the monorepo for services with no consumer but maestro | private, no licence | **public, MIT — as the last step of this refactor** |
| `fps4/maestro-specs` | specs-service, CLI, Action | private, no licence | public, MIT — same last step |
| `fps4/maestro-work`, `fps4/maestro-runtime`, `fps4/maestro-skills` | next components, the plugin | do not exist | public, MIT |
| `fps4/identity-service` | identity | public, MIT | unchanged |
| **`fps4/maestro-config-<tenant>`** — e.g. `maestro-config-tenant1`, `maestro-config-demo` | one tenant's configuration: workspace definitions in the client's vocabulary, policy, adapters by name, CDK context, secret *names* | do not exist | **private, one per tenant** (Q4); `maestro-config-demo` may be public and is the round-trip proof |
| app1 | the tenant's application | the tenant's | unchanged; its maestro glue (the signals module, deploy-event step) lives in its own repo |

---

## 1. Principles for the refactor

1. **Greenfield.** `docs/` is rewritten for the MVP. The corpus is deleted from the tree in one commit, after a tag; nothing is moved, struck through, or archived in place.
2. **Re-derive, don't carry.** Where a new document needs something the corpus got right — the spine invariants, the six work classes and their rules, the onboarding ladder N0–N4, oversight levels and ceilings, the four seams — it is rewritten in the new document's own terms with a one-line credit to the tag. No old identifiers (T-numbers, D-numbers, PS-numbers, W-/R-/X-rules) appear in the new docs.
3. **A fresh decision log.** `docs/decisions/` holds ADRs numbered from 0001, the same shape as `../maestro-specs/docs/design/decisions/`. The rulings of 2026-09-15..18 are the first fifteen (§3.2).
4. **Short, agent-readable.** Every document fits in one read; the whole of `docs/` should stay under ~150 KB. A document that argues with a superseded design has failed the purpose of the purge.
5. **Nothing tenant-identifying in a public repository.** The demo tenant is fictional (`aannemer-x`); the first application is `app1`; anything naming a client, an application, an account id, a hostname, a webhook lives in `maestro-config-<tenant>` or is gitignored (§5).
6. **Milestones are M1–M4.** E and F appear once, in `beyond-mvp.md`. R appears once, there too.
7. **Link integrity is a gate.** A relative-link checker runs in CI on every PR from phase 1 on.
8. **Public last.** Licence and visibility change in the final PR, after the tree is clean (§5's checks green).

---

## 2. Rulings

| # | Question | Ruling (2026-09-18) |
|---|---|---|
| **Q1** | Retired material | **Purge.** Git history behind tag `corpus-2026-09`. No `docs/archive/`, no vision tier. |
| **Q2** | Database | **Atlas Flex.** DynamoDB a deliberate later step if ever. |
| **Q3** | Exit narrows to the export | **Yes.** ADR-0004. |
| **Q4** | Tenant configuration | **One private repository per tenant, short tenant name in the repository name:** `fps4/maestro-config-<tenant>`. §5. |
| **Q5** | Public + licence | **MIT, public, as the last step of the refactor** — `maestro` and `maestro-specs`. |
| **Q6** | Milestone names | **M1–M4.** |
| **Q7** | "Today" landing | Defer to M2. |
| **Q8** | Instance register: one deployable or two | **One deployable** (`runtime-service`): artifact ledger + instance record as two collections, one deploy event. ADR-0011. |
| **Q9** | MVP CI floor | **Secret scan, dependency audit, SBOM emission.** The standards layer is branch R. |
| **Q10** | Severity + signals split | **SEV1–4, app1's P1–P4 mapped 1:1; the signals contract in §0.4.** ADR-0009 and ADR-0012. |

**Q8, the reasoning kept for ADR-0011.** Two facts about a deployment: the **artifact ledger** (what was built: digest, version, SBOM, signature, known-good rollback target) and the **instance record** (what is running where: this digest, in this environment, in this tenant, at this tier and onboarding level, since this deploy event). They are two views of one deploy event, and the one check that matters — a running digest the ledger does not know is an ungated deploy or a compromise — needs both side by side. One deployable, two collections, one event. *What would reopen it:* the platform executing instances itself (out of MVP).

---

## 3. The target tree

```
README.md                        the repo in one screen: what maestro is, the components, where to start
CONTEXT.md                       the ubiquitous language — tenant, workspace, artifact, draft, version, gate,
                                 decision, question, work item, class, instance, run, principal, seat, tier,
                                 onboarding level, consequence class, signal, policy — agent-facing, ≤ 2 pages
CLAUDE.md                        pointers; PR discipline (draft PRs); how to run the link check
LICENSE                          MIT — added in the last PR
docs/
  README.md                      index
  mvp.md                         §0 of this plan, made permanent (scope, out of scope, substrate, spine, tenancy)
  architecture.md                components, ports, isolation, the spine, deployment shape — from the two drawings
  diagrams.md                    the three figures as inline SVG with captions
  roadmap.md                     M1–M4 with gates (§0.2); a pointer to beyond-mvp.md
  use-cases.md                   UC1 human-gated ops · UC1b advisory lane · UC2 run visibility · the others found;
                                 each with its gaps (G-numbers restart at 1 here)
  signals.md                     §0.4: the contract, the envelope, the module, N1/N2 onboarding
  tenancy-and-config.md          §5: deployment-per-tenant default, the per-tenant repository, what a pipeline
                                 checks out, the guards
  operations-model.md            support tiers, commitments and clocks, incident lifecycle, decommission — rewritten
                                 from the corpus in the ops engine's own terms
  governance-model.md            ceilings, oversight levels, capability grants, consequence class — as work-service
                                 reads them at claim; nothing about packs or standards
  build-standards.md             the CI floor (Q9) and the conformance job that runs it
  beyond-mvp.md                  the post-MVP backlog (intake agent, customer tenants) and branch R with the four seams;
                                 one page; the only place E/F/R are described
  components/
    identity-service.md          what the MVP needs from it; AWS deployment; gaps
    specs-service.md             as built (ADR-0012–0018 of maestro-specs); AWS deployment
    work-service.md              the design: envelope, six classes, authority at claim, policy, signals intake,
                                 evidence, board, MCP contract, notifier adapters
    runtime-service.md           the instance register: ledger + instance in one deployable; EventBridge feed; tier and level
    agent-service.md             record half: run-event contract, runner on GitHub Actions, transcript custody, sampling
    spine.md                     archive + queue, relay, sequence rules, export + verifier
  decisions/
    0001 … 0015                  §3.2
scripts/check-links.sh           relative-link integrity across the repo
.github/workflows/docs.yml       runs the link check on every PR
```

### 3.1 What each new document may take from the corpus (and must rewrite)

| New document | Re-derives from the corpus (tag `corpus-2026-09`) |
|---|---|
| `components/spine.md` | the record invariants: attribution on every write; no identity-provider subject stored; sequence assigned by the writing service; event taxonomy; export + verifier readable with services off |
| `components/work-service.md` | the six classes; the work rules; authority at claim; evidence plans; chase ladders |
| `components/runtime-service.md` | the instance shape (artifact digest-pinned, environment, tier, level, hosting party); digest-mismatch is a hard stop |
| `components/agent-service.md` | the run/step/transcript shape; an agent decides nothing at a gate; never exported to a tenant |
| `operations-model.md` | support tiers; response/resolution commitments; remediation classes; decommission |
| `governance-model.md` | oversight levels; consequence class; ceilings; capability grants; onboarding ladder N0–N4 |
| `build-standards.md` | the CI job with groups; a check the substrate makes unrepresentable gets a manifest entry, not a check |
| `beyond-mvp.md` | the four seams; the names of what branch R would add |

Everything else in the corpus — the archetype walks, the derivation audits, the engines, the generation boundary, the standards catalogue, the NL construction use case, the FaaS runtime, the Kafka spine, the Docker PoC, the repository-topology argument, the C4 set — is **not** re-derived.

### 3.2 The decision log — `docs/decisions/`

| ADR | Title | Status |
|---|---|---|
| 0001 | maestro is an ops engine; idea-to-code is out of scope | accepted |
| 0002 | Serverless AWS is the substrate; docker compose is the development loop only | accepted |
| 0003 | The spine is an S3 archive with SNS/SQS delivery; the archive relay ships first; Kafka and RabbitMQ not adopted | accepted |
| 0004 | Exit is the portable export: archive plus verifier, readable with every service off | accepted |
| 0005 | MongoDB Atlas Flex is the MVP database | accepted |
| 0006 | Identity stays identity-service, not Cognito | accepted |
| 0007 | Tenant = deployment by default; workspace isolation stays available inside a deployment | accepted |
| 0008 | Agent-service ships its record half first; the runner is GitHub Actions + Claude Code under an agent principal | accepted |
| 0009 | One severity scale, SEV1–4; policy lives in work-service's definition | accepted |
| 0010 | Tenant configuration lives in one private repository per tenant, `maestro-config-<tenant>` | accepted |
| 0011 | The instance register is one deployable holding the artifact ledger and the instance record | accepted |
| 0012 | Signals: the application owns detection and publishes to its own topic; maestro owns response | accepted |
| 0013 | The intake agent and customer-facing tenants are post-MVP; the regulated domain is a branch with four seams | accepted |
| 0014 | The MVP CI floor: secret scan, dependency audit, SBOM | accepted |
| 0015 | Repositories: one per component with a consumer; maestro-only services live in `fps4/maestro`; public under MIT | accepted |

Each ADR: context in three sentences, the decision, consequences, and *what would reopen it*. No ADR cites a T-number.

---

## 4. The work, in order

Each phase is one draft PR on `refactor/mvp-docs` unless noted. Phases 2 and 3 can be one PR or several.

**Phase 0 — rulings**
- [x] Q1–Q10 ruled (2026-09-18)

**Phase 1 — tag, purge, skeleton** *(PR #1, with phase 2)*
- [x] `git tag corpus-2026-09 main` and push the tag (2026-09-18)
- [x] `git rm -r docs/` — the corpus leaves the tree
- [x] root `README.md`, `CONTEXT.md`, `CLAUDE.md`
- [x] `docs/README.md`, `docs/mvp.md`, `docs/roadmap.md`, `docs/beyond-mvp.md`, `docs/tenancy-and-config.md`, `docs/signals.md`
- [x] `docs/decisions/0001…0015` + `docs/decisions/README.md` index
- [x] `scripts/check-links.sh` (relative links and `#anchors`) + `scripts/check-public.sh` (tenant paths, account ids, `.env`, forbidden strings from a CI secret) + `.github/workflows/docs.yml`; both green locally

**Phase 2 — architecture and components** *(PR #1)*
- [x] `docs/architecture.md`
- [x] `docs/diagrams.md` — four figures as **Mermaid** (GitHub renders it; no SVG files to go stale): component map, UC1 sequence, the spine, the signals split
- [x] `docs/use-cases.md`
- [x] `docs/components/{spine, work-service, runtime-service, agent-service, specs-service, identity-service}.md` + `components/README.md`
- [x] `docs/operations-model.md`, `docs/governance-model.md`, `docs/build-standards.md`
- [ ] the architect's review of PR #1; corrections folded in

**Phase 3 — cross-repository** *(one small PR per repo)*
- [ ] `../maestro-specs/docs/design/architecture.md`: isolation (tenant = deployment default), ports (spine = archive + queue), stack (AWS deployment)
- [ ] `../maestro-specs`: re-point the corpus references — `docs/design/decisions/0017`, `0018` (PS3 / platform-standards citations → the tag or the new docs), `config/workspaces/maestro-platform.yaml` line 1, `docs/design/ui/console-mock.html` PS-labels
- [ ] `../maestro-specs`: remove `config/ds1/` (ds1 retires; it carries hostnames) — same PR
- [ ] memory: `maestro-aws-alternative-and-roadmap`, `specs-service-accessibility-rebuild` point at the new `docs/`

**Phase 4 — public** *(last PR in each repo; the architect flips visibility)*
- [ ] `LICENSE` (MIT, copyright line as identity-service's) in `maestro` and `maestro-specs`
- [ ] §5 guards green in both repos; a grep for client names, account ids, hostnames returns nothing
- [ ] delete this file
- [ ] the architect sets both repositories public

PR discipline: draft PRs, squash-merge on the architect's word only. The merge and SSH grants of 2026-09-15..18 were session-scoped and are **not** carried.

---

## 5. Keeping tenant configuration out of a public repository

**The rule:** a public maestro repository contains code, the design, and one fictional demo tenant. Everything that identifies a real tenant — a client's vocabulary, a policy, an AWS account id, a hostname, a webhook — lives in that tenant's private repository or in a secret store referenced by name. Secrets live in neither.

**One repository per tenant — `fps4/maestro-config-<tenant>`** (`maestro-config-tenant1`, `maestro-config-demo`, …), private, same layout in each:

```
README.md                 who, contacts, which components at which tag — never in a public repo
cdk.context.json          account, region, domain, database endpoint name
workspaces/*.yaml         workspace definitions in the tenant's vocabulary
policy.yaml               severity × tier → clocks; agent ceilings; chase ladders; the SEV↔P mapping
adapters.yaml             notifier targets by name (Slack channel id, SES sender); signal sources (topic ARNs)
applications/*.yaml       the tenant's applications: name, environments, tier, onboarding level, topic ARN
secrets.md                the *names* of secrets in Secrets Manager / SSM — never values
```

`maestro-config-demo` holds the fictional tenant and proves the layout round-trips; it can be public. **The first real tenant's repository exists (private, created 2026-09-18) with this layout; everything that identifies that tenant or its applications lives there.**

**How a deployment uses it:** the tenant repository's pipeline checks out each public component at a tag and runs `cdk deploy` with the repository root as context. The public repositories' own pipelines deploy only the demo tenant.

**Guards in the public repositories (CI, from phase 1):**
- fail on any path matching `config/tenants/**` or `tenants/**`;
- fail on any file containing a 12-digit AWS account id pattern, an `arn:aws:` with an account, or a `.env` that is not `.env.example`;
- fail on a list of forbidden strings kept *outside* the repo (the client names), run as a secret-scan custom pattern — the list itself never lands in the repo.
- The demo tenant stays fictional: `aannemer-x`, "Aannemer X", `usr-j-dekker`. A reviewer who sees a real company name in a public repo treats it as a defect.

**app1:** the tenant's repository keeps its own maestro glue — the signals Terraform module applied, the deploy-event step, the CODEOWNERS that gate merges. Nothing of the tenant's is copied into a maestro repository, including the application's name.

---

## 6. Out of the MVP — kept, not planned

- **Intake agent** (was E): Slack app, Slack↔principal link, `integration_spec` type, OpenSpec block shape, versioned guideline corpus.
- **Customer-facing tenants** (was F): per-tenant CDK app as a product, external reader role, board filters for customers, customer-safe run summaries.
- **Branch R:** pack registry, standards engine, assurance and drift, classification enforced, conformance dossier; forks after M4 on the four seams.

---

## 7. Notes for the next session

- Working tree: `/Users/farid.gurbanov/Repositories/fps4/maestro`, branch `refactor/mvp-docs`. Sibling repositories under `/Users/farid.gurbanov/Repositories/fps4/`.
- `../maestro-specs` test suite: `make mongo`, then in `api/`: `MONGO_URI='mongodb://127.0.0.1:27019/?directConnection=true' MONGO_USER=specs MONGO_PASSWORD=specs npm test` (178 tests as of 2026-09-15).
- Memory index: `~/.claude/projects/-Users-farid-gurbanov-Repositories-fps4-maestro/memory/MEMORY.md` — the entries `maestro-aws-alternative-and-roadmap`, `specs-service-accessibility-rebuild`, `openspec-not-adopted`, `maestro-v2-docs-only-reset` are current; older entries describe maestro v1 and are historical.
