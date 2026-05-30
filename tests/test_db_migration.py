"""Additive schema migrations on connect (US-0024 M7 — db.py _migrate)."""
import sqlite3

from model.audit import LLMAudit, LLMCall
from orchestrator import db


def _columns(conn, table):
    return {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}


def test_fresh_db_has_prompt_provenance_columns():
    conn = db.connect(":memory:")
    cols = _columns(conn, "llm_calls")
    assert {"prompt_template_id", "prompt_template_version"} <= cols
    conn.close()


def test_existing_v2_db_is_migrated_in_place(tmp_path):
    path = str(tmp_path / "old.db")
    # Simulate a pre-US-0024 (v2) DB: an llm_calls table without the provenance columns.
    raw = sqlite3.connect(path)
    raw.execute(
        "CREATE TABLE llm_calls (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, agent TEXT NOT NULL, "
        "model TEXT NOT NULL, tier TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0, "
        "output_tokens INTEGER NOT NULL DEFAULT 0, cache_read INTEGER NOT NULL DEFAULT 0, "
        "cache_write INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0.0, "
        "latency_ms INTEGER NOT NULL DEFAULT 0, finish_reason TEXT, error TEXT, ts REAL NOT NULL)"
    )
    raw.execute("INSERT INTO llm_calls (id, run_id, agent, model, tier, ts) "
                "VALUES ('old1', 'r0', 'spec', 'claude', 'standard', 1.0)")
    raw.commit()
    raw.close()

    # Connecting through db.connect adds the new columns without dropping the old row.
    conn = db.connect(path)
    assert {"prompt_template_id", "prompt_template_version"} <= _columns(conn, "llm_calls")
    old = conn.execute("SELECT * FROM llm_calls WHERE id = 'old1'").fetchone()
    assert old["prompt_template_version"] is None                  # old row reads NULL for new col

    # And a new write with provenance round-trips on the migrated table.
    LLMAudit(conn).record(LLMCall(run_id="r1", agent="spec", model="claude", tier="standard",
                                  prompt_template_id="spec-agent", prompt_template_version="deadbeef"))
    new = conn.execute("SELECT * FROM llm_calls WHERE run_id = 'r1'").fetchone()
    assert new["prompt_template_id"] == "spec-agent"
    conn.close()
