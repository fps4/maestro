"""SQLite connection + schema for maestro's authoritative stores (ADR-0008).

Two tables, both append-only (WORM enforced at the application layer — see eventlog.py / model.audit):
  - ``events``    : the operational source of truth + gate/action audit, hash-chained (ADR-0008/0009)
  - ``llm_calls`` : the per-call LLM audit (OTel GenAI fields; ADR-0002/0009)

Start on SQLite; the schema is Postgres-portable for the cutover when concurrency/recovery demand it
(ADR-0008). The default path lives under ``data/`` (gitignored) so a local run never commits state.
"""
import os
import pathlib
import sqlite3

DEFAULT_DB = "data/maestro.db"

# Bump only by ADDING a migration — never edit an applied one (standards/patterns.yaml).
SCHEMA_VERSION = 1

_SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    seq        INTEGER PRIMARY KEY,         -- global monotonic sequence; the chain order
    run_id     TEXT    NOT NULL,            -- correlation id threading a delivery task (ADR-0009)
    ts         REAL    NOT NULL,            -- epoch seconds
    actor      TEXT    NOT NULL,            -- who/what caused it (agent id, human handle, 'orchestrator')
    type       TEXT    NOT NULL,            -- event type, e.g. 'merge-approval', 'merge.executed'
    target     TEXT,                        -- the thing acted on (task id, pr ref, ...)
    payload    TEXT    NOT NULL,            -- canonical JSON
    prev_hash  TEXT    NOT NULL,            -- hash of the previous row (genesis = 64 zeros)
    hash       TEXT    NOT NULL             -- sha256 over this row's canonical form
);
CREATE INDEX IF NOT EXISTS idx_events_run_id ON events (run_id);
CREATE INDEX IF NOT EXISTS idx_events_type   ON events (type);

CREATE TABLE IF NOT EXISTS llm_calls (
    id            TEXT    PRIMARY KEY,       -- uuid
    run_id        TEXT    NOT NULL,
    agent         TEXT    NOT NULL,          -- agent identity (e.g. 'spec-1')
    model         TEXT    NOT NULL,          -- the resolved model id (tier -> model)
    tier          TEXT    NOT NULL,          -- fast | standard | strong
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read    INTEGER NOT NULL DEFAULT 0,   -- distinct key (ADR-0009 cache-token convention)
    cache_write   INTEGER NOT NULL DEFAULT 0,   -- distinct key
    cost_usd      REAL    NOT NULL DEFAULT 0.0,  -- token x price-card
    latency_ms    INTEGER NOT NULL DEFAULT 0,
    finish_reason TEXT,                          -- stop_reason, or 'error' on a failed attempt
    error         TEXT,                          -- set when the call failed (still recorded)
    ts            REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_llm_calls_run_id ON llm_calls (run_id);

CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def connect(path: str | None = None, *, check_same_thread: bool = True) -> sqlite3.Connection:
    """Open (creating if needed) a configured connection and ensure the schema exists.

    Pass ``":memory:"`` for an ephemeral store (tests). A real path's parent dir is created.

    ``check_same_thread`` defaults to True (sqlite3's thread-affinity guard — the engine's write path is
    single-threaded). The **read-only** workspace API serves from request threads, so it opens a
    dedicated connection with this relaxed (``readapi.py`` serialises its reads); concurrency hardening
    is the SQLite→Postgres cutover (ADR-0008).
    """
    db_path = path or os.environ.get("MAESTRO_DB", DEFAULT_DB)
    if db_path != ":memory:":
        pathlib.Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=check_same_thread)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(_SCHEMA)
    conn.execute(
        "INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('version', ?)",
        (str(SCHEMA_VERSION),),
    )
    conn.commit()
    return conn
