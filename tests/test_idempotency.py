"""The 24h-TTL idempotency store (workspace-write-api.md §idempotency)."""
from orchestrator.idempotency import IdempotencyStore


def test_lookup_miss_returns_none(idempotency):
    assert idempotency.lookup("@arch", "POST /tasks", "k-1") is None


def test_remember_then_lookup_round_trips(idempotency):
    idempotency.remember(
        "@arch", "POST /tasks", "k-1",
        request_hash="h1",
        response={"task_id": "run-7"},
        event_seq=42,
    )
    cached = idempotency.lookup("@arch", "POST /tasks", "k-1")
    assert cached is not None
    assert cached["request_hash"] == "h1"
    assert cached["response"] == {"task_id": "run-7"}
    assert cached["event_seq"] == 42


def test_keys_are_scoped_to_participant_and_endpoint(idempotency):
    """The same key under a different participant or endpoint is a different cache slot."""
    idempotency.remember("@arch", "POST /tasks", "k-1",
                         request_hash="h1", response={"a": 1}, event_seq=1)
    assert idempotency.lookup("@arch", "POST /tasks", "k-1") is not None
    assert idempotency.lookup("@dev", "POST /tasks", "k-1") is None
    assert idempotency.lookup("@arch", "POST /comments", "k-1") is None


def test_expired_rows_are_purged_on_lookup(conn):
    """Rows older than the 24h TTL must be invisible (and gone) on the next lookup — the table
    stays bounded without an external janitor."""
    fake_clock = [1_000_000.0]
    store = IdempotencyStore(conn, clock=lambda: fake_clock[0])
    store.remember("@arch", "POST /tasks", "k-1",
                   request_hash="h1", response={"a": 1}, event_seq=1)
    # Jump past the 24h TTL.
    fake_clock[0] += store.TTL_SECONDS + 1
    assert store.lookup("@arch", "POST /tasks", "k-1") is None
    # And it's gone from the DB, not just hidden.
    assert conn.execute("SELECT COUNT(*) AS n FROM idempotency_keys").fetchone()["n"] == 0
