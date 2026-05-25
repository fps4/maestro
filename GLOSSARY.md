# Glossary

| Term | Definition |
|------|------------|
| maestro | This platform. The conductor that coordinates a crew of AI agents under a human architect's direction. The agents are the orchestra; the architect holds the baton. |
| Architect | The human user — also the technical product owner. Sets direction, makes architectural decisions, is the default reviewer at every gate, and merges. A participant in every product. |
| Product | The unit of work: one or more repositories and one or more human participants, with one `product_type`. The thing maestro builds. (maestro is itself a product that builds products.) |
| Product type | `commercial` or `technical`. The only axis that routes a review away from the architect: a commercial product's functional review goes to the product reviewer. |
| Participant | A human attached to a product via a role (e.g. `architect`, `functional_reviewer`, `stakeholder`). Roles are per-product; a person can hold different roles in different products. Carries per-surface ids (`slack_user_id` / `telegram_user_id`) so a decision can be authorised and attributed (ADR-0011). |
| Delivery task | One unit of work inside a product, targeting one repository, moving through the spec-driven loop. |
| Charter | The durable, product-level principles and constraints — the product's "constitution." maestro's own charter is `docs/principles.md`. |
| Functional spec | The "what & why" artifact: user stories and acceptance criteria (in EARS form). Reviewed at the functional gate, before any code. |
| Technical design | The "how" artifact: architecture, data and API contracts, and an ordered task list. Reviewed at the technical (design) gate. |
| EARS | Easy Approach to Requirements Syntax — "WHEN [condition] THE SYSTEM SHALL [behaviour]." Makes acceptance criteria unambiguous and testable. |
| Gate | A point where the pipeline pauses for a human decision before continuing. maestro has two: functional (pre-code) and technical (design, and merge). Delivered to the responsible role's group surface, where any role-holder may decide (ADR-0011). |
| Surface | A human-control channel type behind one gate-delivery interface (ADR-0011). Architects → a shared **Slack** channel; functional reviewers → the product's **Telegram** group via a per-product bot. Pluggable: a new surface plugs in without changing routing. |
| Functional review | Review of *what* is built — the spec. Routed per `config/reviewers.yaml`. |
| Technical review | Review of *how* it is built — design and the PR diff. Always performed by the architect. |
| Definition of Done | The set of automated quality gates that must pass before the human technical gate opens (see `docs/guides/sdlc.md`). |
| Traceability | First-class links from requirement → task → PR/commit, so "is the product done?" aggregates across repos. |
| Conductor | Informal name for the orchestrator — sequences agents and owns gate state; performs no LLM inference. |
| ModelClient | The single internal client that calls the Anthropic API directly and records cost + audit for every call. The only LLM egress. |
| Product register | The git-tracked registry of products (`config/products.yaml`) — their repos, participants/roles, product_type, deploy target, and visibility. Changing it is a reviewed PR (ADR-0008). |
| Event log | The append-only record of state changes and agent/human actions; maestro's operational source of truth. Current state is a projection of it (event-sourcing + CQRS; ADR-0008). |
| Audit log | The immutable tier: the LLM-call audit (every `ModelClient` call) plus the gate-decision/agent-action event log. Long-retention, tamper-evident (ADR-0009). |
| Correlation ID (`run_id`) | The single id threading every LLM call, event, gate decision, and operational log line for one run — so a run is reconstructible end to end. |
