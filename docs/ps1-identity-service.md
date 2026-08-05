# PS1 — Identity and Tenancy — Service Design

**Status:** Draft v0.1 — for refinement
**Repo:** mstr-idp = 'identity-service'
**Companions:** `conceptual-design.md` (v0.8) is authoritative for *what* and *why*; `technical-design.md` (v0.5) for build order, substrate, and the tenancy model in its §3.3; `ps2-record-spine.md` (v0.2) records against the principal model defined here. Precedence runs in that order and this document is wrong where it conflicts.
**Scope:** The composite that satisfies PS1 — authentication adopted from `identity-service`, and the governance identity layer built in maestro. Covers principals, tenants and membership, agent principals, seats and oversight occupancy, and delegated administration.
**Decided in technical design v0.5 (T31):** `identity-service` **is** PS1's authentication half. This document assesses it, states what maestro builds on top, and records the gaps as fixed, accepted, or sent back.

---

## 1. The split, and why it is the service's own design

`identity-service`'s **ADR-0005** already draws the line: it is *"the identity authority and a Policy Information Point — not a central Policy Decision Point."* It asserts identity and coarse roles; each consuming product owns the fine-grained mapping. Taking that at its word makes PS1 two halves rather than one service with a retrofit.

| | Owner | Holds |
|---|---|---|
| **Authentication** | `identity-service` — **adopted** | Credentials, federation, token issuance, JWKS, sessions, invites, the Application/Assignment entitlement gate |
| **Governance identity** | **maestro — built** | Tenants and membership, the principal registry, agent principals, seats and oversight occupancy, delegated administration, accountability |

**This is what keeps §2.2's claim true.** The technical design says isolation is enforced in the identity model; the identity model in question is maestro's, layered over a shared authentication pool. Tenancy, agent principals, seats, and oversight levels are governance concepts — they were never `identity-service`'s problem to solve, and pushing them down into it would contradict ADR-0005 in the same breath as adopting it.

```
   ┌──────────────────────────── PS1 ────────────────────────────┐
   │                                                             │
   │  identity-service (adopted)          maestro (built)           │
   │  ┌───────────────────────┐          ┌────────────────────┐  │
   │  │ users, credentials    │          │ principal registry │  │
   │  │ federation (Google)   │──token──▶│ tenants + membership│ │
   │  │ applications          │  (iss,   │ agent principals   │  │
   │  │ assignments (gate)    │   sub)   │ seats + oversight  │  │
   │  │ JWKS, sessions        │          │ delegation context │  │
   │  └───────────────────────┘          └─────────┬──────────┘  │
   └─────────────────────────────────────────────── │ ───────────┘
                                                    ▼
                                    maestro principal id ──▶ PS2, PS3, PS4
```

---

## 2. What maestro builds

### 2.1 The principal registry — and why it exists at all

**No maestro record stores an identity provider's `sub`** (T30, and R13 in PS2). A local user's subject is `users._id`, minted per `identity-service` deployment. Move a tenant from the logical isolation level to its own deployment (§3.3) and every local subject is re-minted — against PS2 events whose `accountable` and `acting` fields are immutable and retained for years.

```yaml
principal:
  id:            prn-7Q2K…          # maestro's own. The ONLY id that reaches PS2, PS3, PS4
  kind:          human | agent | service
  bindings:                          # many, because the same person survives a migration
    - issuer:    https://id.example.com
      subject:   4c1e…               # identity-service `sub`
      bound_at:  2026-08-03
      active:    true
  display:       Jan Dekker
  status:        active | suspended | retired
```

With the indirection a migration re-points a binding row. Without it, a migration is a data migration through sealed archive segments — which is to say the deployment dial in T28 is not actually available. **This is the single cheapest decision in PS1 and the most expensive omission.**

**`kind` is not decoration.** P12 requires that a named human is accountable for every governed decision and that agents cannot hold accountability. PS2 enforces it — an `accountable` field resolving to a principal whose `kind` is not `human` is a rejected append — and that enforcement is only possible because `kind` lives here.

### 2.2 Tenants and membership

`identity-service` has no tenant and will not gain one (ADR-0018). maestro holds the whole model:

```yaml
membership:
  tenant:        tnt-aannemer-x
  principal:     prn-7Q2K…
  roles:         [ owner ]           # Sponsor | Owner | Steward | Auditor | member
  scope:         { application: app-441 }   # Owner and Steward are per application
  granted_by:    prn-3B8M…
  status:        active | suspended
  external:      false               # §2.4
```

**maestro's governance roles cannot ride on `Assignment.roles`.** An `Assignment` is `(user, Application)` where the Application is the whole maestro product; Sponsor, Owner, and Steward are per `(tenant, application instance)`. Use the Assignment as the coarse entitlement gate it was built to be — *may this person use maestro at all* — and keep governance roles here, where they can carry a tenant and an application scope.

**Role collapse is recorded, not prevented** (§3.1 of the conceptual design). In a twelve-person aannemer, Sponsor, Owner, and Steward are one person. Permit it and emit a recorded risk acceptance; a membership model that forbids it will simply be worked around.

**Separation of duties is checked at the gate, not here** (P5). Membership grants candidacy; PS4 refuses a gate decision where the accepting principal is the recorded originator of the artifact (D36). Enforcing it at membership time would force tenants to invent second accounts.

### 2.3 Agent principals

**The gap this closes.** In `identity-service` a machine principal is an `oauth_client` with `client_credentials` plus an optional static `subject` and `claims`. That is exactly one fixed subject per credential. maestro needs many agent principals, each occupying a seat, each act carrying a different accountable human and a different oversight level in force — which no static claim can express. T2 names this as the single most likely early mistake.

**The model, three things kept apart:**

| | Is | Lives in |
|---|---|---|
| **Agent runtime** | The deployed process. Authenticates with a client credential | `identity-service` — one `oauth_client` per runtime |
| **Agent principal** | The actor recorded on a decision — `agt-case-shaper-3` | maestro principal registry, `kind: agent` |
| **Seat occupancy** | *This agent principal occupies this seat, in this tenant, at this oversight level, from this time* | maestro, and it is versioned |

An act therefore carries: the acting agent principal, the seat, the oversight level in force, and the accountable human — four separate answers, which is what §12.4 demands.

**The residual risk, stated rather than hidden.** A compromised agent runtime could assert an attribution it is not entitled to. Two controls: a runtime is bound to an enumerated set of seats it may act on, and **PS4 verifies that the acting principal actually occupied the seat at that time** rather than trusting the assertion. Occupancy is versioned precisely so that check is answerable retrospectively.

**Demotion must not depend on token revocation.** §12.2 requires an O4 seat producing a bad outcome to drop to O2 immediately. Oversight level is deliberately *not* a token claim — it is read from seat occupancy at decision time — so demotion takes effect on the next act rather than on the next token refresh. Putting the level in the token would silently reintroduce the token TTL as the demotion latency.

### 2.4 The external population

§8 makes actor topology a platform requirement: an External portal serves subcontractors and ZZP'ers, an identity population with a different lifecycle, assurance level, and offboarding path from tenant staff. T-K asks whether it is even the same identity service.

**Answer: the same pool, a different Application, and assurance on the membership — not on the person.** One human legitimately holds different assurance in different contexts; a ZZP'er invited to one tenant's portal is not thereby assured to another's. Assurance is a property of a relationship, which is why it sits on membership (`external: true` plus an assurance level) rather than on the principal.

The shared pool has one consequence worth stating plainly: **`unique {email}` is deployment-wide**, so a person who is both a tenant employee and an external subcontractor elsewhere is one user. That is correct — one human, one identity, several memberships — and it is the same property that makes §7.5 work. It is also why §3's enumeration gap matters more here than it would in a single-product deployment.

### 2.5 Delegated administration

§7.5 requires cross-tenant administrative identity, scoped delegation, and audit that distinguishes *the client did this* from *their advisor did this on their behalf*. `identity-service` has no `act` claim and no token exchange.

**Resolved in maestro, not by adding RFC 8693.** The advisor authenticates as themselves; maestro resolves their memberships; a request carries an explicit tenant context which maestro validates against those memberships; and the PS2 event records the acting principal, the tenant, and — where the acting principal is not a member of the tenant in their own right — the delegation that authorised it.

Two things this buys. The token stays tenant-agnostic, so switching tenant context needs no re-issue. And the delegation is on the *record* rather than in the token, which is where §7.5 actually needs it — an auditor reads events, not expired JWTs.

**The shared user pool is a feature here, not a defect.** An accountancy practice's advisor is one human with memberships in twelve tenants, which is exactly what ADR-0018's single pool produces naturally.

---

## 3. Gap assessment

Ranked by consequence. Where the fix lives is as important as the fix.

| # | Gap | Fix | Where |
|---|---|---|---|
| **G1** | maestro storing an `identity-service` `sub` would make the deployment dial unavailable | Principal registry indirection (§2.1) | **maestro** |
| **G2** | Agents are credentials, not principals (T2) | Agent principal + seat occupancy model (§2.3) | **maestro** |
| **G3** | No tenant; governance roles cannot ride on `Assignment.roles` | maestro owns tenancy and membership (§2.2) | **maestro** |
| **G4** | External population has no assurance marker and shares the pool | Assurance on membership; separate Application per population (§2.4) | **maestro**, plus a suggestion (§4) |
| **G5** | No delegated "on behalf of" — no `act` claim, no token exchange | Delegation resolved and recorded by maestro (§2.5) | **maestro** |
| **G6** | `audit_logs` is a private collection and never reaches PS2 | Ingest or emit principal-lifecycle events (§3.1) | **both** |
| **G7** | Cross-tenant email enumeration via the shared pool | Uniform responses in maestro's flows (§3.2) | **maestro** |
| **G8** | ADR-0018's deciding premise has a consumer it did not anticipate | Record the inherited properties as accepted (§3.3) | **maestro** |

**Six of eight are maestro's.** That is the expected shape when a service is adopted along the line its own ADR-0005 draws — the gaps are not defects in `identity-service`, they are the half of PS1 that was always going to be built.

### 3.1 G6 — principal lifecycle must reach PS2

`audit_logs` records `/admin` calls with the acting principal, action, target, and resulting status. It is a good record and it is in the wrong place: assignment granted, credential rotated, user disabled, and signing key rotated are governance facts, and under D39 `identity-service` is an onboarded application whose facts belong on the spine.

Two options, and the second is a suggestion to that repository (§4):

1. **maestro ingests** `audit_logs` through the admin API on a schedule, projecting them into PS2 as `PrincipalLifecycleRecorded`. Works today; polling latency; maestro owns the mapping.
2. **`identity-service` emits** outbound on the same events. Cleaner, lower latency, and it is the shape N2 onboarding wants anyway.

Start with (1) so PS2 is complete from the first client, and treat (2) as the improvement.

### 3.2 G7 — enumeration

`unique {email}` deployment-wide means a registration or password-reset flow can reveal whether an address exists anywhere in the pool — across tenants. In a single-product deployment that is a minor concern; with maestro it is a cross-tenant information leak, and the tenant is §7.1's audit boundary.

Uniform responses and uniform timing in maestro's registration, invite-redemption, and reset flows. This is maestro's to get right because maestro owns the surfaces; the underlying uniqueness is correct and should not change.

### 3.3 G8 — an inherited premise, accepted explicitly

ADR-0018 records its deciding requirement: *"a single deployment will never need to host more than one isolated user population."* maestro does not violate it — it layers tenants above a single pool and asks `identity-service` to partition nothing. But it does inherit consequences that requirement was not weighing, and inheriting them silently is how they become surprises:

- Email uniqueness is deployment-wide, so one human is one user across all tenants (§2.4 — desirable, and load-bearing for §7.5)
- The enumeration surface in §3.2
- Subjects are per-deployment and re-mint on migration (§2.1)

**All three are accepted, and the acceptance is recorded here rather than assumed.** None of them argues for reintroducing Tenant into `identity-service`; the first is a feature, and the other two have maestro-side answers.

---

## 4. Note — two suggestions for `identity-service`

Recorded here rather than sent as changes, because that repository owns its own decisions and neither of these blocks maestro. Both are small.

**4.1 Put `assuranceLevel` on `Assignment`, not on `User`.** One person legitimately holds different assurance in different contexts — a subcontractor invited to a portal is not thereby assured for an operator console. Assurance is a property of a relationship, and `Assignment` is already the relationship. Putting it on `User` would force either a lowest-common-denominator value or a second user record for the same human, and the second is precisely what the single pool exists to avoid. This is the concrete answer to maestro's T-K and would be useful to any consumer with more than one population.

**4.2 Emit principal-lifecycle events outbound.** A webhook or a stream carrying the same facts `audit_logs` already records — assignment granted or suspended, credential rotated, user status changed, signing key rotated. Consumers currently have to poll the admin API to learn that a principal changed, and any consumer with its own audit substrate is reconstructing a record `identity-service` already holds. §3.1 above; maestro will poll in the meantime.

Neither is a defect. Both are the kind of thing that is cheap while the schema is young.

---

## 5. Build order and gates

| # | Step | Gate |
|---|---|---|
| 1 | Principal registry with `kind` and provider bindings | A principal survives a re-minted provider subject: the binding is re-pointed and every prior reference still resolves |
| 2 | Tenants and membership, with roles scoped to `(tenant, application)` | A member of tenant A holds no resolvable capability in tenant B, by absence of membership rather than by a check |
| 3 | Tenant-scoped handle acquisition (T28) | Every data access in PS2 and PS3 goes through a handle bound once per request; a code search finds no query naming a tenant |
| 4 | Agent principals and versioned seat occupancy | An agent principal is distinguishable from the human accountable for its seat *and* from its runtime credential, in one query — and occupancy at a past instant is answerable |
| 5 | Delegated administration context | An advisor acting in a client tenant produces an event distinguishing their act from the client's own |
| 6 | Lifecycle ingestion from `identity-service` | An assignment suspension appears on the spine as a governance event |

**Steps 1–3 gate PS2's first append.** Step 4 gates the first agent-occupied seat, which under §12.5 is not the first client anyway — everything ships at O0–O1, so agent principals must be *modelled* from the start and need not be *occupied*.

---

## 6. Decisions

| # | Decision | Rationale |
|---|---|---|
| I1 | **PS1 is `identity-service` for authentication plus a maestro-built governance identity layer** | ADR-0005 already places the boundary there. Tenancy, agent principals, seats, and oversight are governance concepts, and pushing them down would contradict the ADR in the act of adopting it |
| I2 | **maestro keeps a principal registry; no maestro record stores a provider `sub`** | T30. Subjects re-mint per deployment; PS2's attribution fields are immutable and multi-year. Without it the §3.3 deployment dial does not exist |
| I3 | **`kind` on the principal is what makes P12 enforceable** | PS2 rejects an `accountable` that is not a human. Accountability that cannot be mechanically checked is a sentence, not a control |
| I4 | **Governance roles live in maestro membership, scoped to `(tenant, application)`; `Assignment` stays a coarse entitlement gate** | Sponsor, Owner, and Steward are per tenant and per application; an Assignment is per product. Overloading it would flatten a dimension that P5 depends on |
| I5 | **Agent runtime, agent principal, and seat occupancy are three separate things** | T2. One credential carries one static subject; §12.4 needs four separately answerable facts per act |
| I6 | **Oversight level is read from seat occupancy at decision time, never carried as a token claim** | §12.2's demotion must be immediate; a token claim makes the TTL the demotion latency |
| I7 | **Assurance is a property of membership, not of a person** | One human holds different assurance in different contexts (§2.4); the alternative is a second identity for the same person, which the shared pool exists to prevent |
| I8 | **Delegation is resolved by maestro and recorded on the event, not asserted in the token** | §7.5 needs the distinction in the audit record, which outlives the token by years |
| I9 | **ADR-0018's inherited consequences are accepted and recorded, not worked around** | Deployment-wide email uniqueness is load-bearing for §7.5; the other two have maestro-side answers. Silent inheritance is how a premise becomes a surprise |

---

## 7. Open

- **I-A.** Whether an agent principal is per seat, per runtime instance, or per logical agent. Per seat makes occupancy trivial and multiplies principals; per runtime is fewer records and makes "which agent did this" ambiguous when one runtime serves several seats.
- **I-B.** How a principal is retired without breaking history. `status: retired` keeps references resolvable; whether a retired principal's display name is still readable after a GDPR erasure request against the person is not decided, and it collides with T25.
- **I-C.** Whether membership is versioned in PS2 like everything else, or is current-state with an event trail. Versioning is consistent; current-state is what every authorisation check actually reads.
- **I-D.** What happens to an external principal when the tenant that invited them offboards them, if they hold memberships in other tenants. The pool is shared; the offboarding is not.
- **I-E.** Whether the platform's own tenant (D39) uses the same membership model or a distinct operator model. Same model is more consistent and gives the platform no special case; distinct is what most operators expect.

*Inherited:* **T-K** (identity assurance for the external population — §2.4 proposes an answer, §4.1 carries the suggestion that would make it native).

---

## 8. Change log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-08-03 | Initial design, following the v0.5 decision to adopt `identity-service` (T31). PS1 established as a composite along ADR-0005's own boundary: authentication adopted, governance identity built (I1). **Principal registry with provider-binding indirection** (I2) as the prerequisite that makes the §3.3 deployment dial real, with `kind` as the mechanism that makes P12 enforceable (I3). Governance roles placed in maestro membership rather than on `Assignment` (I4). **Agent runtime, agent principal, and seat occupancy separated** (I5), closing T2, with oversight read at decision time rather than carried in a token (I6). Assurance placed on membership (I7), proposing an answer to T-K. Delegation resolved by maestro and recorded on the event (I8). Eight gaps assessed — six maestro's, one shared, one accepted — with ADR-0018's inherited consequences recorded rather than assumed (I9). §4 carries two suggestions for `identity-service`. I-A to I-E opened |
