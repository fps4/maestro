# spikes

Time-boxed, **throwaway** exploration code — *not* the engine, and deliberately **not** bound by
the SDLC / Definition of Done. A spike answers one question quickly; once answered it is either
deleted or graduated into an ADR + real engine code.

| Spike | Question | Status |
|------|----------|--------|
| _none active_ | — | — |

Spikes may fake anything that isn't the thing under test (the LLM, the DoD gates, the GitHub/Slack adapters).

## Retired

- **`langgraph/`** (2026-05-25 → 2026-05-28) — answered the question *"is LangGraph the right orchestration runtime for maestro's gated delivery loop?"* with **yes** ([ADR-0014](../docs/architecture/decisions/0014-orchestration-runtime-langgraph.md)); retired once the decision was acted on. Code lived at `spikes/langgraph/`; see `git log` for the proof-of-concept history.
