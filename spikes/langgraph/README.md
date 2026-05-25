# Spike: LangGraph as the orchestration runtime

**Question:** does LangGraph's human-in-the-loop model fit maestro's gated delivery loop — and does
it coexist cleanly with the decisions we've already made (the `ModelClient` egress, the
event-sourced audit log)? The runtime ADR is **deferred** until we've run this.

## What it demonstrates

The maestro delivery loop as a LangGraph state machine:

```
spec → [functional gate] → design → [technical/design gate] → build → [merge gate] → done
         request_changes ↩            request_changes ↩                 request_changes ↩
```

- **Gates are LangGraph `interrupt()`s** — the graph pauses, a human decides (approve / request_changes /
  reject), and it resumes with `Command(resume=...)`. This is the mechanic we'd lean on for every gate.
- **Durable resume across restarts** — state is checkpointed to `.run/checkpoints.sqlite`, so you can
  `start` in one process and `resume` in another. (Directly probes the ADR-0008 question.)
- **`ModelClient` stays the single LLM egress (ADR-0002)** — nodes call `model.complete(...)`, *not*
  LangChain's LLM wrappers. The egress records a per-call audit line (ADR-0009).
- **A separate append-only event log** (`.run/events.jsonl`) illustrates maestro keeping its own
  **source of truth** (ADR-0008/0009) *alongside* LangGraph's checkpointer — the key thing to judge:
  do the two layers coexist, or fight?

## What it fakes (on purpose)

The LLM (a stub unless you opt in), the DoD quality gates, the GitHub/Slack adapters, and the real
surfaces. None of that is the question under test.

## Run it

```bash
cd spikes/langgraph
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python run.py start  --intent "add OAuth login to the API"     # runs to the functional gate, then pauses
python run.py resume --thread <id> --decision approve          # → design gate
python run.py resume --thread <id> --decision request_changes --feedback "tighten scope"   # loops back
python run.py state  --thread <id>                             # inspect state + the event log
```

Set `MAESTRO_REAL_LLM=1` and `ANTHROPIC_API_KEY=...` to swap the stub for a real Claude call.

## Findings (first run — 2026-05-25)

- [x] **interrupt/resume maps cleanly to gates** — all three gates pause via `interrupt()` and
  resume via `Command(resume=...)`; `request_changes` loops back to the producing node and re-pauses
  (verified: spec → request_changes → spec re-drafted → re-pause). Resume works **in a separate
  process** (durable via the SQLite checkpointer).
- [x] **`ModelClient` egress preserved without friction** — nodes call `model.complete(...)`; no
  LangChain LLM wrapper involved; every call is audited. ADR-0002 holds.
- [~] **checkpointer vs. our event log — they coexist, but watch duplication.** The checkpointer is
  the *execution/recovery* layer (graph state, resumability); our append-only event log is the
  *domain source of truth + audit* (ADR-0008/0009). They didn't fight. Open design point for the ADR:
  keep the **event log authoritative** for audit/traceability and treat the checkpointer as a
  rebuildable execution cache — don't let the checkpointer become a second, divergent source of truth.
- [ ] **subagents / "deep agents" for the crew** — not exercised here (single graph); evaluate next.
- **Verdict so far:** strong positive signal. LangGraph is a credible runtime; before writing the
  runtime ADR, resolve (a) the checkpointer↔event-log authority split and (b) the crew/subagent model.

> Throwaway spike. Not the engine; not SDLC/DoD-bound (see [`../README.md`](../README.md)).
