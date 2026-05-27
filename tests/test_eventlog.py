"""The append-only, hash-chained event log (ADR-0008/0009)."""
import pytest

from orchestrator.eventlog import GENESIS_HASH, ChainBroken


def test_append_assigns_monotonic_seq_and_chains_hashes(events):
    a = events.append(run_id="r", actor="orchestrator", type="task.created", payload={"n": 1})
    b = events.append(run_id="r", actor="orchestrator", type="spec.drafted", payload={"n": 2})
    assert (a["seq"], b["seq"]) == (1, 2)
    assert a["prev_hash"] == GENESIS_HASH
    assert b["prev_hash"] == a["hash"]          # b chains onto a


def test_read_filters_by_run(events):
    events.append(run_id="r1", actor="x", type="t", payload={})
    events.append(run_id="r2", actor="x", type="t", payload={})
    assert len(events.read()) == 2
    assert len(events.read("r1")) == 1


def test_verify_chain_passes_for_an_untouched_log(events):
    for i in range(5):
        events.append(run_id="r", actor="x", type="t", payload={"i": i})
    assert events.verify_chain() is True


def test_verify_chain_detects_an_altered_payload(events, conn):
    events.append(run_id="r", actor="x", type="t", payload={"amount": 1})
    e2 = events.append(run_id="r", actor="x", type="t", payload={"amount": 2})
    conn.execute("UPDATE events SET payload = ? WHERE seq = ?", ('{"amount":9999}', e2["seq"]))
    conn.commit()
    with pytest.raises(ChainBroken):
        events.verify_chain()


def test_verify_chain_detects_a_deleted_row(events, conn):
    events.append(run_id="r", actor="x", type="t", payload={"i": 1})
    events.append(run_id="r", actor="x", type="t", payload={"i": 2})
    events.append(run_id="r", actor="x", type="t", payload={"i": 3})
    conn.execute("DELETE FROM events WHERE seq = 2")
    conn.commit()
    with pytest.raises(ChainBroken):
        events.verify_chain()  # seq=3's prev_hash no longer matches seq=1's hash


def test_log_offers_no_mutation_api(events):
    assert not hasattr(events, "update")
    assert not hasattr(events, "delete")
