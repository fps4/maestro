# UX — the surfaces

What a person sees, and the rules every screen obeys. The components have their own consoles (specs-service's exists; work-service's, agent-service's and runtime-service's are M2–M4); one landing page ties them together. This page is the record of the surface decisions; a design canvas outside the repositories renders them and is redrawn when this page changes, not the other way round. The current canvas is the one accepted on 2026-09-19 ([below](#the-redraw--accepted-2026-09-19)).

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
| **Today** | work-service console · M2 | Decide · Answer · Owed · Agents at work | designed 2026-09-19 |
| **Register** | specs-service | lineage, type, phase, state, open questions, last decision, version, updated | built; demo content re-seeded to the MVP types |
| **The document** | specs-service | one text; beside it *what the gate will read*, derived; *ask an assistant* drafts into the document and never proposes | built |
| **The decision page** | specs-service | rule 5; phone-first | built |
| **Owed — the frontier** | work-service · M2 | rows: class · about (an instance or a version) · answerable (a person) · acting (person or agent, marked) · due (derived) · next human touchpoint; tiles: breached · due this week · escalated out (rate, per application) · held by agents; a side panel of what agents did today, as facts | designed 2026-09-19 |
| **A work item** | work-service · M2 | the envelope; why it is with you (rule 8); the evidence plan — what `done` requires, each a fact named to its event; the timeline — facts on the record, the person's gates marked; about: instance, level, tier, specification, clocks with *met*; signal → item as a panel | designed 2026-09-19, in two states: closed `done`, and refused at claim |
| **Board** | work-service · M2 | seven columns over the state machine (open · assigned · in progress · blocked · escalated · resolved · closed today), by milestone and application, with the machine written under it | designed 2026-09-19 |
| **Run page** | agent-service · M3 | who · ceiling in force · the plan with the current step; the timeline of steps and tool calls with a refusal shown as a check that held; the next human touchpoint; beside it the sampling queue, the refusal rates per skill set and seat, and the transcript described — classification, retention, digest — never shown | designed 2026-09-19 |
| **Estate** | runtime-service · M4 | every application × environment: version and digest, onboarding level, tier, last deploy and by whom, open items, rollback target; a digest the ledger does not know as a hard stop row; levels per application with the escalated-out rate beside each | designed 2026-09-19 |
| **Signal → item** | work-service · M4 | how a storm became one item; suppression and maintenance windows in force | designed 2026-09-19 as a panel on the work item, not a screen |
| **Sign in** | identity-service | one card, one action | built |

The specs-service screens follow the console design reference in `fps4/maestro-specs/docs/design/ui/` — tokens, component vocabulary, state treatments. The other consoles adopt the same reference.

## The redraw · accepted 2026-09-19

The canvas that designed Today, the frontier and the work item before 2026-09-18 showed a business-case chain, a standards catalogue, instances on self-hosted machines, an ad-hoc severity, and "autonomy" for what is now the oversight level. The rules above survived; the content did not. It was redrawn as its own design session on 2026-09-19 and accepted by the architect the same day. What the accepted canvas shows, and what this page now holds it to:

- **UC1 on app1, end to end**, across Today, the work item, the decision page and the run page: a SEV2 from app1's own monitor via `ops-signals` → fourteen alarms correlated into one `remediation` item with derived clocks → an RCA run proposes a `cause_analysis`, answers a question on it, proposes version 2 → accepted at `rca_review` on a phone → a fix run opens a draft PR → merged under CODEOWNERS by a second person, the answerable person unchanged → deploy event → alarm OK → closed `done` on three facts. A person at three points and nowhere else, each marked on the timeline.
- **UC1b's refusal**: a patch-class claim on an N1 application refused at claim, escalated to the answerable person with the agent's recommendation and the three choices; `escalated_out` shown as a rate per application beside the choices, as the argument for N2. Because app1 is at N2, the refusal is drawn on a second fictional application, **app2** (operated N1, tier2), which also gives the Estate and the rate something to compare.
- **Sample data in the MVP's words**: tenant `aannemer-x`, applications `app1` and `app2`, four fictional people (an operations owner, an owner, a steward, a reviewer), agent principals named by run kind, instances on AWS environments, SEV1–4, O0–O4, N0–N2, no packs or standards, nothing self-hosted.
- **The board, the run page and the estate, drawn for the first time**; signal → item drawn as a panel on the work item rather than a screen.
- **The brand** is the specs-service console reference verbatim — its tokens, the mutability line carried by form, state legible without colour, identifiers in monospace — with no levers exposed.

The artboards link to one another as a prototype; nothing else on them is interactive. The canvas stays outside the repositories and is not linked from here; a change to a rule or a screen on this page is what triggers the next redraw.
