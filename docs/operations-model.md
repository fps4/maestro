# Operations model

What maestro commits to when it operates an application, and what it refuses to commit to. This is the contract [work-service](components/work-service.md) enforces.

## Support tiers

| Tier | Scope | Owner | Becomes |
|---|---|---|---|
| **S1** | usage questions, "what does this mean" | the explainer agent, then a person | answered, or a `support` item |
| **S2** | application misbehaviour, data correction, configuration | operations | a `remediation` item |
| **S3** | a maestro defect, a substrate failure, a security event | maestro engineering | a `remediation` item on maestro's own tenant |
| **S4** | the application does what was asked, incorrectly | the application's owner | a `change` item; on an application with no specification, an intent-recovery task |
| **S5** | the application is correct and no longer needed | the application's owner | a `review` item; decommission |

S4 and S5 are the ones most often mishandled. When someone says "it's broken", the engine must separate a defect from a specification error from an obsolete purpose. Only the first is maestro's.

## Commitments

Per **criticality tier** of the application, set in the tenant's policy:

- availability target (observed, not guaranteed, below N2);
- **response** and **resolution** times by severity — `respond_by` and `resolve_by` on every item, derived, never typed;
- maximum patch latency for security findings by severity;
- notice period for a breaking change to maestro itself.

**Commitments are bounded by authority.** At **N1** maestro commits availability and response, never correctness — it does not hold change control. Correctness starts at **N2**. Selling correctness at N1 is how an ops business fails; the engine refuses to raise a correctness-shaped commitment on an N1 application, at raise, not at claim.

## Clocks

- `respond_by` and `resolve_by` are derived from severity × tier × onboarding level.
- Breach is computed from `opened_at` and the **original** severity, never from current state — reopening inside the window does not reset the clock.
- The chase ladder — reminder → chase → escalate to the accountable → escalate to the steward → breach recorded — is policy, versioned, and every step's delivery is recorded.
- Business-hours calendars and clock pause for *waiting on the tenant* are policy fields from the first build, even if the MVP sets them to always-on.

## Severity

SEV1–4, one scale ([ADR-0009](decisions/0009-one-severity-scale.md)). An application's own scale maps once in policy. Severity is resolved from signal kind × tier; an agent may propose a reclassification; a person confirms it as a recorded fact with a reason.

## Incident lifecycle

```
signal ─▶ item raised (severity, clocks) ─▶ claimed (authority checked) ─▶ in progress
      ─▶ analysis proposed ─▶ accepted by a person ─▶ fix proposed ─▶ merged by a person
      ─▶ deploy event ─▶ signal ok ─▶ evidence plan satisfied ─▶ closed done
```

Every closure carries one of five outcomes: `done`, `superseded`, `escalated_out`, `refused`, `expired`. **`escalated_out` is not a failure**: it is the correct N1 output for a fix the engine may not take, and the *rate* of them per application is the argument for N2.

A SEV ≤ 2 closure raises a `review` item — the post-incident review — with the accountable person as its owner. Its finding is recorded, not filed.

## Rollback

Every deploy event carries the previous artifact as the known-good rollback target, held by [runtime-service](components/runtime-service.md). A rollback is a restore-class act (N1) on a managed pipeline and a recommendation (escalated_out) where maestro holds no pipeline authority. Rollback rehearsal is a recurring `review` item per production application.

## Decommission

A `review` item that closes an application's record: capability grants and credentials revoked, dependent applications and external parties notified, data exported in usable form, evidence retained beyond the application's life, and a final instance state of `retired` in the register. Retention outlives the software.

## Exit

The tenant takes the [export](components/spine.md#export-and-verify) — archive, manifests, verifier — and reads it with every maestro service off. Nothing else is promised, and nothing else is needed.
