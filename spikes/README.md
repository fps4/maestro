# spikes

Time-boxed, **throwaway** exploration code — *not* the engine, and deliberately **not** bound by
the SDLC / Definition of Done. A spike answers one question quickly; once answered it is either
deleted or graduated into an ADR + real engine code.

| Spike | Question | Status |
|------|----------|--------|
| [`langgraph/`](langgraph/) | Is LangGraph the right orchestration runtime for maestro's gated delivery loop? | open — runtime ADR **deferred** until this is evaluated |

Spikes may fake anything that isn't the thing under test (here: the LLM, the DoD gates, the GitHub/Slack adapters).
