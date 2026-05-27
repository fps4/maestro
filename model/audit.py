"""The per-call LLM audit sink (store 1 of ADR-0009; OTel GenAI fields).

One immutable record per `ModelClient` call — successful or failed. maestro owns its LLM cost/audit
trail (ADR-0002); this is its system of record for spend and replay. Append-only at the application
layer: this writes rows, nothing updates or deletes them.
"""
import sqlite3
import time
import uuid
from dataclasses import asdict, dataclass
from typing import Optional


@dataclass
class LLMCall:
    run_id: str
    agent: str
    model: str
    tier: str
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read: int = 0
    cache_write: int = 0
    cost_usd: float = 0.0
    latency_ms: int = 0
    finish_reason: Optional[str] = None
    error: Optional[str] = None
    id: str = ""
    ts: float = 0.0


class LLMAudit:
    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def record(self, call: LLMCall) -> LLMCall:
        call.id = call.id or uuid.uuid4().hex
        call.ts = call.ts or round(time.time(), 6)
        d = asdict(call)
        self._conn.execute(
            "INSERT INTO llm_calls (id, run_id, agent, model, tier, input_tokens, output_tokens, "
            "cache_read, cache_write, cost_usd, latency_ms, finish_reason, error, ts) "
            "VALUES (:id, :run_id, :agent, :model, :tier, :input_tokens, :output_tokens, "
            ":cache_read, :cache_write, :cost_usd, :latency_ms, :finish_reason, :error, :ts)",
            d,
        )
        self._conn.commit()
        return call

    def read(self, run_id: Optional[str] = None) -> list[dict]:
        if run_id is None:
            rows = self._conn.execute("SELECT * FROM llm_calls ORDER BY ts").fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM llm_calls WHERE run_id = ? ORDER BY ts", (run_id,)
            ).fetchall()
        return [dict(r) for r in rows]
