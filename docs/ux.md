# UX — the surfaces

What a person sees, and the rules every screen obeys. The components have their own consoles (specs-service's exists; work-service's, agent-service's and runtime-service's are M2–M4); one landing page ties them together. This page is the record of the surface decisions; a design canvas outside the repositories renders them and is redrawn when this page changes, not the other way round.

## Rules

1. **One landing, three verbs.** A person opens **Today** and finds only what needs them, in order of who can do it: **Decide** (only a named person can), **Answer** (a question on a version they wrote), **Owed** (items they are answerable for) — then what agents are doing meanwhile. Nothing on it is a feed.
2. **Agents are a table of facts, never a chat.** Run, what it is doing, its ceiling, the next human touchpoint. A person never converses with a run on a maestro surface; the run's reasoning is a transcript for the reader role.
3. **Ledgers, not trees.** The **register** (specs-service) and the **frontier** (work-service) are tables of what is in flight. No page tree, no sprints, no story points. A superseded version never appears in a ledger; history belongs to the artifact.
4. **Derived, and shown derived.** Every clock, severity and ceiling is computed from policy and displayed with its derivation — *resolve by 09:00 · SEV2 × tier1 × N1 · policy v2* — and no surface offers a field to type one.
5. **The decision page is one column** ([specs-service ADR-0013](components/specs-service.md)), read top to bottom: what am I asked · what this is · what changed since the last decided version · what the checks found · open questions (an assistant may draft an answer; the asker closes) · what each outcome would do · the buttons. The same packet an agent reads over MCP. The build gate is a phone: a person accepts a cause analysis on a phone, in two minutes, without asking anyone.
6. **Labels, not identifiers.** A decider never sees `rca_review`; identifiers (digests, ordinals, lineage ids) are monospace when they must appear.
7. **State reads without colour; mutability is carried by form.** A draft has dashed edges and live controls; a version has a solid rule and no edit affordance. An agent's contribution is dashed until a person confirms it.
8. **Refusal is a page, not an error.** When an agent is refused at claim, the item comes to the answerable person with the agent's recommendation and three honest choices: *let the agent do it under my name* · *I will do it* · *decline, and record why*. Whoever acts, the answerable person does not change, and the surface says so.
9. **`escalated_out` is an outcome and a rate**, shown per application as the argument for the next onboarding level — never styled as a failure.
10. **The register and the frontier filter by application and milestone**, and by *mine · held by agents · unclaimed*. Preferences persist per person.

## The screens

| Screen | Component · milestone | Carries | State |
|---|---|---|---|
| **Today** | work-service console · M2 | Decide · Answer · Owed · Agents at work | designed on the pre-MVP canvas; redraw owed (below) |
| **Register** | specs-service | lineage, type, phase, state, open questions, last decision, version, updated | built; demo content re-seeded to the MVP types |
| **The document** | specs-service | one text; beside it *what the gate will read*, derived; *ask an assistant* drafts into the document and never proposes | built |
| **The decision page** | specs-service | rule 5; phone-first | built |
| **Owed — the frontier** | work-service · M2 | rows: class · about (an instance or a version) · answerable (a person) · acting (person or agent, marked) · due (derived); tiles: breached · due this week · escalated out (rate) · held by agents; a side panel of what agents did today, as facts | designed on the pre-MVP canvas; redraw owed |
| **A work item** | work-service · M2 | the envelope; why it is with you (rule 8); the evidence plan — what `done` requires, each a fact; the timeline — facts on the record; about: instance, level, tier, specification, clocks | designed on the pre-MVP canvas; redraw owed |
| **Board** | work-service · M2 | kanban over the state machine, by milestone and application | not designed |
| **Run page** | agent-service · M3 | plan, timeline, tool calls, ceiling in force, refusals, next human touchpoint; the sampling queue beside it | not designed |
| **Estate** | runtime-service · M4 | every application × environment: digest, onboarding level, tier, last deploy, open items; a digest the ledger does not know as a hard stop | not designed |
| **Signal → item** | work-service · M4 | how a storm became one item; suppression and maintenance windows in force | not designed |
| **Sign in** | identity-service | one card, one action | built |

The specs-service screens follow the console design reference in `fps4/maestro-specs/docs/design/ui/` — tokens, component vocabulary, state treatments. The other consoles adopt the same reference.

## The redraw

The canvas that designed Today, the frontier and the work item predates the rulings of 2026-09-18: its specs screens show a business-case chain and a standards catalogue, its work screens show instances on self-hosted machines, an ad-hoc severity, and "autonomy" for what is now the oversight level. The rules above survived; the content did not. The redraw is a design session, after the refactor, with this acceptance:

- **UC1 on app1, end to end**, across Today, the work item, the decision page and the run page: a SEV2 from app1's `ops-signals` topic → a `remediation` item with derived clocks → an RCA run proposes a `cause_analysis` → accepted at `rca_review` on a phone → a fix run opens a draft PR → merged under CODEOWNERS → deploy event → alarm OK → closed `done`.
- **UC1b's refusal**: a patch-class claim on an N1 application refused, escalated to the answerable person with the recommendation and the three choices.
- **Sample data in the MVP's words**: tenant `aannemer-x`, application `app1`, fictional people, instances on AWS environments, SEV1–4, O0–O4, N0–N2, no packs or standards, nothing self-hosted.
- The board, the run page and the estate drawn for the first time.

Until then, read the mechanism from the existing canvas and the words from this page.
