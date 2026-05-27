"""The append-only, hash-chained event log — maestro's operational source of truth + the
gate/action audit tier (ADR-0008/0009).

State transitions are appended here; current state is a *projection* of the log (see projection.py),
so the pipeline is recoverable across restarts by replay. Audit and operational state are one log and
its projections (CQRS), not two databases (ADR-0008).

Tamper-evidence (ADR-0009): every row carries ``prev_hash`` (the previous row's hash) and its own
``hash`` (sha256 over its canonical form). Because ADR-0016 makes the merge-approval *event* the sole
authority for a merge — with no GitHub-side backstop — this chain is security-critical: a forged or
back-dated approval breaks the chain and is detectable via :meth:`verify_chain`.

WORM is enforced at the application layer: this class offers ``append`` and reads only — no update or
delete path exists.
"""
import hashlib
import json
import sqlite3
from typing import Any, Optional

GENESIS_HASH = "0" * 64


def _canonical(record: dict) -> str:
    """Deterministic serialization for hashing (stable key order, no whitespace)."""
    return json.dumps(record, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_hash(seq: int, run_id: str, ts: float, actor: str, type: str,
                 target: Optional[str], payload: dict, prev_hash: str) -> str:
    body = _canonical({
        "seq": seq, "run_id": run_id, "ts": ts, "actor": actor, "type": type,
        "target": target, "payload": payload, "prev_hash": prev_hash,
    })
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


class EventLog:
    """Append-only, hash-chained event log over a SQLite connection."""

    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def append(self, run_id: str, actor: str, type: str, payload: dict,
               target: Optional[str] = None, ts: Optional[float] = None) -> dict:
        """Append one event and return it. ``ts`` is injectable for deterministic tests."""
        import time
        ts = round(time.time(), 6) if ts is None else ts
        cur = self._conn.execute("SELECT seq, hash FROM events ORDER BY seq DESC LIMIT 1")
        last = cur.fetchone()
        seq = (last["seq"] + 1) if last else 1
        prev_hash = last["hash"] if last else GENESIS_HASH
        h = compute_hash(seq, run_id, ts, actor, type, target, payload, prev_hash)
        self._conn.execute(
            "INSERT INTO events (seq, run_id, ts, actor, type, target, payload, prev_hash, hash) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (seq, run_id, ts, actor, type, target, _canonical(payload), prev_hash, h),
        )
        self._conn.commit()
        return {"seq": seq, "run_id": run_id, "ts": ts, "actor": actor, "type": type,
                "target": target, "payload": payload, "prev_hash": prev_hash, "hash": h}

    def read(self, run_id: Optional[str] = None) -> list[dict]:
        """Read events in chain order, optionally filtered to one run."""
        if run_id is None:
            rows = self._conn.execute("SELECT * FROM events ORDER BY seq").fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM events WHERE run_id = ? ORDER BY seq", (run_id,)
            ).fetchall()
        return [self._row(r) for r in rows]

    def verify_chain(self) -> bool:
        """Recompute the chain and confirm no row was altered, inserted, or reordered.

        Raises :class:`ChainBroken` on the first inconsistency (with the offending seq), so callers
        get a precise tamper signal rather than a bare False.
        """
        prev_hash = GENESIS_HASH
        for r in self._conn.execute("SELECT * FROM events ORDER BY seq").fetchall():
            e = self._row(r)
            if e["prev_hash"] != prev_hash:
                raise ChainBroken(f"event seq={e['seq']}: prev_hash does not match the prior row")
            recomputed = compute_hash(e["seq"], e["run_id"], e["ts"], e["actor"], e["type"],
                                      e["target"], e["payload"], e["prev_hash"])
            if recomputed != e["hash"]:
                raise ChainBroken(f"event seq={e['seq']}: hash mismatch (row was altered)")
            prev_hash = e["hash"]
        return True

    @staticmethod
    def _row(r: sqlite3.Row) -> dict:
        d = dict(r)
        d["payload"] = json.loads(d["payload"])
        return d


class ChainBroken(Exception):
    """The event log's hash chain failed verification — tamper or corruption (ADR-0009)."""
