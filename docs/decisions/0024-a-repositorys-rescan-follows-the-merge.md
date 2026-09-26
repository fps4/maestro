# ADR-0024 · A repository's re-scan follows the merge, not the deploy

**Status:** proposed · 2026-09-26 · amends [ADR-0019](0019-work-services-table.md) §5 (the arming of `rescan_clear`)

## Context

[ADR-0019](0019-work-services-table.md) §5 arms an item's evidence in plan order, "the order of the world". A fact that arrives for an entry not yet armed is dropped. An advisory's plan is `merged_change`, `deploy_event`, `rescan_clear`, so the re-scan was armed only once the deploy was seen.

That order does not hold for the scanner the MVP has. Dependabot's `fixed` is a re-scan of the **repository**, and it fires once the fix is on the default branch: seconds to minutes after the merge, usually before the deploy has finished. Under §5 it arrives unarmed and is dropped. The item then waits for a re-scan that never comes again, until `review_by` expires it. The advisory lane (acceptance scenario W5) could not close `done` against a real repository. It passed in code only because the test sent the facts in the order §5 expected.

## Decision

1. **`rescan_clear` and `deploy_event` both follow the merge, and neither waits for the other.** Each is armed once `merged_change` is satisfied, with the merge's time as its lower bound. The item closes `done` when all three are satisfied, in whichever order the last two arrive. Every other entry still waits for every earlier entry of another kind.
2. **`rescan_clear` means the repository's re-scan**: Dependabot, and code scanning. A scan of what is deployed, such as Inspector or ECR findings against a digest, does follow the deploy. It gets its own evidence kind when runtime-service's scan intake is built, and that kind waits for the deploy.

## Consequences

- An advisory closes `done` on a merge, a deploy after it and a clear re-scan after it, which is what [use-cases.md](../use-cases.md#uc1b--the-advisory-lane) asks of the MVP's scanner.
- The re-scan now shows that the merged change fixed the advisory in the repository. It does not show that the deployed artifact is clear. That needs the deployed-digest scan in decision 2, until which the lane's evidence says what Dependabot can know.
- The event schema and the plans on existing items do not change. Only the arming rule does, in `work/api/src/domain/evidence.ts`, and a rebuild re-derives expectations from the heads with the same rule.
- One race remains. A `fixed` delivered before the `pull_request` `closed` for the same merge is still dropped. GitHub sends `closed` at the merge; Dependabot re-scans only after the push. If it is ever seen, the fix is to keep an unmatched fact for a short window and apply it when its entry is armed.

## What would reopen it

A scanner whose all-clear can arrive before the merge it depends on is recorded. The early-fact window in the last consequence would then be needed.
