"""Idempotency keys for the workspace write API (workspace-write-api.md §idempotency).

Every write endpoint accepts a client-supplied ``Idempotency-Key`` header. A retry with the same
``(participant, endpoint, key)`` returns the **original response**, exactly — same status, same body,
same ``event_seq`` — so a stuttering network does not double-append a ``comment.posted`` or (worse)
``gate.decided`` event. A retry with the same key but a **different body** raises
:class:`IdempotencyMismatch` — the client must mint a fresh key for a substantively different request.

Keys are remembered for **24 hours** (long enough to survive any realistic client retry; shorter than
any natural request tree). Rows older than the TTL are purged on lookup so the table stays bounded.

The store lives in the same SQLite file as the event log + LLM audit (``orchestrator/db.py``) so the
operator has one DB to back up; it is **not** WORM — expired rows are deleted.
"""
import json
import sqlite3
import time
from typing import Optional


class IdempotencyStore:
    """Lookup + remember + TTL-purge over the ``idempotency_keys`` table."""

    TTL_SECONDS = 24 * 60 * 60

    def __init__(self, conn: sqlite3.Connection, *, clock=None):
        """``clock`` is injectable for deterministic TTL tests."""
        self._conn = conn
        self._clock = clock or time.time

    def lookup(self, participant: str, endpoint: str, key: str) -> Optional[dict]:
        """Return the cached entry (after TTL purge) or None if there is no live key for this triple.

        Returns a dict with keys ``request_hash``, ``response``, ``event_seq``, ``created_at``.
        """
        self._purge_expired()
        row = self._conn.execute(
            "SELECT request_hash, response_body, event_seq, created_at "
            "FROM idempotency_keys WHERE participant = ? AND endpoint = ? AND key = ?",
            (participant, endpoint, key),
        ).fetchone()
        if row is None:
            return None
        return {
            "request_hash": row["request_hash"],
            "response": json.loads(row["response_body"]),
            "event_seq": row["event_seq"],
            "created_at": row["created_at"],
        }

    def remember(self, participant: str, endpoint: str, key: str, *,
                 request_hash: str, response: dict, event_seq: int) -> None:
        """Store ``response`` keyed by ``(participant, endpoint, key)``. Raises on duplicate keys —
        the caller (the write API) checks :meth:`lookup` first under its write lock so this insert
        is always fresh."""
        self._conn.execute(
            "INSERT INTO idempotency_keys "
            "(participant, endpoint, key, request_hash, response_body, event_seq, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (participant, endpoint, key, request_hash,
             json.dumps(response, default=str), event_seq, self._clock()),
        )
        self._conn.commit()

    def _purge_expired(self) -> None:
        cutoff = self._clock() - self.TTL_SECONDS
        self._conn.execute("DELETE FROM idempotency_keys WHERE created_at < ?", (cutoff,))
        self._conn.commit()
