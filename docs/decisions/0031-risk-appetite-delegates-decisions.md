# ADR-0031 · Risk appetite: each application sets who decides at each risk grade; an agent decides only where that appetite delegates it; accountability never moves

**Status:** proposed · 2026-09-29 · replaces "agents never decide" ([architecture.md](../architecture.md), [practices.md](../practices.md), [CONTEXT.md](../../CONTEXT.md)) and the "automated approval is unavailable, at all" consequence of specs-service [ADR-0005](../../specs/docs/decisions/0005-agents-may-author-never-decide.md); keeps ADR-0005's rules on drafts, versions, `acting` and `accountable`, and no decision tool on MCP

## Context

"Agents never decide" is stated in four places and enforced by specs-service ADR-0005: only a named human decides at a gate, and no MCP tool records a decision. [practices.md](../practices.md) already relaxes it for rules: a low-grade change is approved by a rule the tenant wrote. The [governance model](../governance-model.md) relaxes it further. Its levels O3 and O4 say "who decides: agent". So the slogan and the level table disagree.

The slogan is also the wrong control for most applications:
- **Too strict for most applications.** An internal tool and a system that files to a government endpoint carry the same rule. So the internal tool pays for a person at every gate, or the gate is declared non-blocking. ADR-0005 offers that as the honest alternative, and it drops review altogether.
- **Not what the rule protects.** The rule has protected two things all along:
  - a human is answerable for every accepted outcome;
  - every accepted outcome traces back to a decision a person made.

  Neither needs the person to take every decision. Both need a person to decide *who* decides.

The architect decided on 2026-09-29:
- how much judgment is delegated is a **risk appetite** set per application;
- critical-grade decisions stay with a human;
- a second human decider is the appetite's choice, not a floor. A one-person organisation cannot provide one.

## Decision

### 1. The invariant

**An agent decides only where a human has delegated that decision in the application's risk appetite, within the ceilings. Accountability never moves.**

- `accountable` is always a human, on every decision, as ADR-0005 §3–4 requires.
- Every decision records its **basis**: `human`, `rule` (with the policy version) or `agent` (with the appetite version and the run). "Who approved this?" always ends at a person: the one who accepted the appetite, or the policy, that the decision was taken under.

### 2. Four risk grades

The risk grade from [practices.md](../practices.md#the-risk-grade) has four steps: **low, medium, high, critical**. The grade is computed by the tenant's versioned policy and never typed in. The policy says what reaches critical. Typical triggers:
- consequence class c4 or above;
- an irreversible act on a tier-1 application;
- an exception to a freeze window.

The grade measures what is at stake. The appetite never changes it: **the appetite chooses the route, and the grade stays computed.**

### 3. The risk appetite is a versioned artifact, per application

The appetite is an artifact type in specs-service, one per application. It is accepted at a gate by the application's accountable owner, because setting it is itself a decision. This settles practices.md's open question of where the risk policy lives. The grade function stays in work-service's policy beside severity, and the appetite that routes the grade is agreed in specs-service.

For each grade the appetite names a **decider**:

| Decider | Means | Levels it permits |
|---|---|---|
| `human` | a named person at the gate | O0–O2 |
| `rule` | a rule the tenant wrote, recorded under its version | O3–O4 |
| `rule+agent` | the rule approves and an agent concurs. Either objecting sends the decision to a person | O3–O4 |
| `agent` | an agent run's verdict is the decision; a person may veto before effect (O3) or reviews after (O4) | O3–O4 |

For `high` and `critical` it also says whether a **second human decider** is required. That choice is the appetite's.

**Three presets**, which an appetite starts from and may override per practice:

| Grade | cautious | balanced (default) | delegating |
|---|---|---|---|
| low | human | rule+agent, O4, sampled | agent, O4, sampled |
| medium | human | agent, O3: a person may veto before effect | agent, O3 |
| high | human | human | human |
| critical | human, second decider required | human, second decider optional | human, second decider optional |

### 4. Floors no appetite lowers

Enforced in code where the decision is recorded. An appetite that crosses one is refused at its own gate.

- **Critical and high are decided by a human.**
- **Always a human, at any grade:**
  - changing an appetite or a risk policy;
  - an exception to a freeze window;
  - deciding an onboarding level;
  - a data correction where the value is binding.
- **The ceilings in the [governance model](../governance-model.md#ceilings) still cap every route.**
  - Consequence class tightens them.
  - A seat whose ceiling is O2, such as accepting a cause analysis, stays with a person whatever the appetite says.
- **The onboarding level bounds the appetite.** An N1 application has no change decisions to delegate.
- **An agent does not decide on its own work.** The deciding run is a different run, of a different kind, from the one that authored or proposed the version. ADR-0005's `exclude_proposer` applies to agent principals by default.
- **Sampling above O2 never reaches zero.**
  - Every decision an agent takes keeps its transcript ([ADR-0030](0030-agent-runs-on-fargate.md)).
  - At least the review floor of those decisions reaches a person.
- **No MCP tool records a decision.** An agent's verdict is a run's output. The service records it as a decision only if the appetite in force delegates that grade to that seat, and refuses it otherwise. The decision carries:
  - `acting`: the agent;
  - `accountable`: the owner who accepted the appetite;
  - `basis: agent`, with the appetite version.

### 5. When the second decider is waived

When the appetite leaves the second decider optional and no second person decides a high or critical change, the decision records `second_decider: waived under appetite vN`, as ADR-0005 §7 records a separation-of-duties exemption on the decision rather than permitting it silently. At **critical**, the change assessor's review becomes the second key:
- it is required on the decision page before the person decides;
- a decision against its objection records the override.

### 6. The appetite is a maximum, not the level in force

**The appetite permits a level; the seat earns it.** A seat starts at O2 and is promoted by its record on this application, in the governance model's order of error visibility, up to what the appetite allows.

**Tightening is immediate and needs no gate:**
- demotion on an adverse outcome;
- a confirmed change-induced incident;
- a spent error budget;
- a freeze window.

**Loosening takes a new appetite version, accepted at its gate.**

## Consequences

- **Proportionality without fake approvers.** An internal tool can let an agent decide low and medium changes. A regulated system can stay cautious. Both records still answer "who approved this?" with a person and a version.
- **A one-person organisation can run maestro honestly.** The waived second decider is visible on every decision it affects, and an agent's objection is a second key that cannot be waived at critical.
- **Agent authority is non-replayable, unlike a rule.** That is why:
  - `rule+agent` is the default at low, and an agent alone can only block;
  - sole agent approval is reached by promotion, not by configuration;
  - the transcript and the review floor are kept for every such decision.
- **specs-service gains one path, not a second acceptance path.** The single code path that accepts (ADR-0005 §2) gains a check of the decision's basis against the appetite in force.
- **The MVP is unchanged.** It ships O0–O2 ([ADR-0022](0022-one-mvp-built-whole.md)), and every decision in it has `basis: human`. What changes after the MVP: the `basis` field on a decision, the appetite artifact type, and the delegated route. They are built with risk-graded change routing, first in [practices.md](../practices.md#order-after-the-mvp)'s order.

## Reopen if

- An agent's decision is reversed or causes an incident at a rate above a person's at the same grade on the same application. The presets would then loosen too far.
- A client's regulator refuses any delegated decision. Branch R would then fix every regulated application at `cautious`.
- A second person joins the architect. The default for critical would then become second decider required.
