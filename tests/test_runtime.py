"""The LangGraph runtime (ADR-0014) — graph topology + dispatch/resume mechanics.

These tests use **no-op closures** for ``run_spec`` / ``run_design`` so the graph's routing is
exercised without the agent stack. Real agent integration sits at the seam:
:func:`orchestrator.agents.spec.run_spec_for_run` is what production wires in, and
:mod:`tests.test_spec_agent` already covers it end-to-end. Keeping the runtime tests free of the
LLM stub lets a regression name itself precisely as a graph-shape bug vs an agent bug.

InMemorySaver everywhere here — SqliteSaver lives behind ``maestro serve --engine`` and is the
operator's surface, not a unit-tested code path. A future hardening slice can add a SqliteSaver
round-trip test once the DB schema is part of the contract.
"""
import threading

import pytest

# Skip the whole module cleanly when langgraph isn't installed — the dep is declared in
# pyproject.toml and the slice's PR comment names the install one-liner; CI installs it.
pytest.importorskip("langgraph", reason="install langgraph: pip install -e '.'")

from concurrent.futures import ThreadPoolExecutor  # noqa: E402

from orchestrator.runtime import (  # noqa: E402
    DrainSwitch,
    LangGraphRuntime,
    make_async_dispatcher,
    make_async_resumer,
)


def _record(calls):
    """Closure that records its run_id arg into ``calls`` so a test can assert what the runtime
    invoked. Returns a no-op for the producer-event side; production passes the real spec helper
    that actually emits ``spec.drafted``."""
    return lambda run_id: calls.append(run_id)


# --- happy path -----------------------------------------------------------------------------------

def test_dispatch_runs_spec_node_and_suspends_at_functional_gate():
    spec_calls: list[str] = []
    runtime = LangGraphRuntime(run_spec=_record(spec_calls))
    runtime.dispatch("run-1")

    # The spec node fired once; the graph is now paused at the functional-gate interrupt waiting
    # for resume_for_decision().
    assert spec_calls == ["run-1"]
    snap = runtime.state("run-1")
    assert snap.next == ("await_functional_gate",)


def test_approve_functional_routes_to_design_then_suspends_at_design_gate():
    """The full M1 happy path through the topology — no design helper attached, so design_node is
    the stub from graph.py (lets us verify routing without #8's agent)."""
    spec_calls: list[str] = []
    runtime = LangGraphRuntime(run_spec=_record(spec_calls))
    runtime.dispatch("run-1")
    runtime.resume_for_decision("run-1", gate_type="functional", decision="approve")

    snap = runtime.state("run-1")
    assert snap.next == ("await_design_gate",)
    # The spec node did NOT re-run on approve.
    assert spec_calls == ["run-1"]


def test_approve_design_advances_through_build_to_await_dod():
    """M2 #3: design approval now routes to build_node, which advances to await_dod and suspends
    there waiting for the CI poller. The graph is no longer terminal at this point — M1 ended
    here; M2 carries on through build → DoD → merge."""
    runtime = LangGraphRuntime(run_spec=_record([]))
    runtime.dispatch("run-1")
    runtime.resume_for_decision("run-1", "functional", "approve")
    runtime.resume_for_decision("run-1", "technical_design", "approve")

    snap = runtime.state("run-1")
    assert snap.next == ("await_dod",)


# --- request_changes loops -----------------------------------------------------------------------

def test_request_changes_on_functional_re_runs_spec_node():
    """The loop the refinement cycle (ADR-0020) rides on — request_changes routes back to the
    producer. ``spec_calls`` increments because the spec node re-runs."""
    spec_calls: list[str] = []
    runtime = LangGraphRuntime(run_spec=_record(spec_calls))
    runtime.dispatch("run-1")
    runtime.resume_for_decision("run-1", "functional", "request_changes")

    snap = runtime.state("run-1")
    assert snap.next == ("await_functional_gate",)        # back at the gate, awaiting next decision
    assert spec_calls == ["run-1", "run-1"]               # ran once on dispatch, again on revise


def test_request_changes_on_design_re_runs_design_node():
    """Same loop, on the design gate. design_node is a stub for #8 so we don't have an agent to
    observe, but we can assert the routing brought us back to await_design_gate (not END)."""
    runtime = LangGraphRuntime(run_spec=_record([]))
    runtime.dispatch("run-1")
    runtime.resume_for_decision("run-1", "functional", "approve")
    runtime.resume_for_decision("run-1", "technical_design", "request_changes")

    snap = runtime.state("run-1")
    assert snap.next == ("await_design_gate",)


# --- reject ends the graph -----------------------------------------------------------------------

def test_reject_on_functional_ends_the_graph():
    """Reject is terminal at the graph level — the run does not loop. The projection records
    status=cancelled from the gate.decided event itself; the graph just stops."""
    runtime = LangGraphRuntime(run_spec=_record([]))
    runtime.dispatch("run-1")
    runtime.resume_for_decision("run-1", "functional", "reject")

    assert runtime.state("run-1").next == ()


def test_reject_on_design_ends_the_graph():
    runtime = LangGraphRuntime(run_spec=_record([]))
    runtime.dispatch("run-1")
    runtime.resume_for_decision("run-1", "functional", "approve")
    runtime.resume_for_decision("run-1", "technical_design", "reject")

    assert runtime.state("run-1").next == ()


# --- design helper wires in (the #8 seam) -------------------------------------------------------

def test_design_helper_is_called_on_approve():
    """When #8 plugs in ``run_design_for_run``, the design node calls it before suspending at the
    design gate. We pass a stub here to pin that the seam is in place — #8 just swaps the closure."""
    design_calls: list[str] = []
    runtime = LangGraphRuntime(run_spec=_record([]),
                               run_design=_record(design_calls))
    runtime.dispatch("run-1")
    runtime.resume_for_decision("run-1", "functional", "approve")

    assert design_calls == ["run-1"]


# --- concurrency: per-task lock so two decisions on different tasks don't tangle ----------------

def test_concurrent_dispatches_on_different_tasks_are_independent():
    """Two tasks dispatch concurrently — the per-thread-id lock means they run independently
    (each suspends at its own gate). The runtime's serialisation is per-run, not global."""
    spec_calls: list[str] = []
    runtime = LangGraphRuntime(run_spec=_record(spec_calls))

    threads = [threading.Thread(target=runtime.dispatch, args=(f"run-{i}",)) for i in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=5)

    # Both spec nodes ran exactly once each; both graphs suspended at the functional gate.
    assert sorted(spec_calls) == [f"run-{i}" for i in range(5)]
    for i in range(5):
        assert runtime.state(f"run-{i}").next == ("await_functional_gate",)


# --- state introspection -------------------------------------------------------------------------

def test_state_returns_a_snapshot_with_the_carry_state():
    """``runtime.state(run_id)`` is what ops uses to answer 'where is this task?' independently
    of the projection."""
    runtime = LangGraphRuntime(run_spec=_record([]))
    runtime.dispatch("run-1")
    runtime.resume_for_decision("run-1", "functional", "approve")

    snap = runtime.state("run-1")
    assert snap.values.get("last_decision") == "approve"
    assert snap.values.get("last_gate_type") == "functional"


# --- M2 #3: build → DoD → merge_gate → merge_exec topology --------------------------------------


def _advance_to(runtime: LangGraphRuntime, run_id: str, stop: str) -> None:
    """Step the runtime through the M1 prefix until it suspends at the named M2 node.

    Reduces M2 test boilerplate — every M2 test starts from "design has been approved" or later.
    """
    runtime.dispatch(run_id)
    runtime.resume_for_decision(run_id, "functional", "approve")
    runtime.resume_for_decision(run_id, "technical_design", "approve")
    if stop == "await_dod":
        return
    runtime.resume_for_dod(run_id, "green")
    if stop == "await_merge_gate":
        return
    raise ValueError(f"unsupported stop {stop!r}")


def test_build_helper_is_called_on_design_approve():
    """When M2 #4 plugs in the builder agent's dispatcher, the build node calls it before
    suspending at await_dod. Pin the seam here so #4 just swaps the closure."""
    build_calls: list[str] = []
    runtime = LangGraphRuntime(run_spec=_record([]),
                               run_build=_record(build_calls))
    runtime.dispatch("run-1")
    runtime.resume_for_decision("run-1", "functional", "approve")
    runtime.resume_for_decision("run-1", "technical_design", "approve")

    assert build_calls == ["run-1"]


def test_test_agent_runs_after_builder_in_build_node():
    """US-0014: the test agent (run_tests) fires in build_node right after the builder, so its
    spec-derived tests land in the same PR before the DoD wait — and strictly after the builder."""
    order: list[str] = []
    runtime = LangGraphRuntime(run_spec=_record([]),
                               run_build=lambda rid: order.append(f"build:{rid}"),
                               run_tests=lambda rid: order.append(f"tests:{rid}"))
    runtime.dispatch("run-1")
    runtime.resume_for_decision("run-1", "functional", "approve")
    runtime.resume_for_decision("run-1", "technical_design", "approve")

    assert order == ["build:run-1", "tests:run-1"]


def test_test_agent_hook_is_optional():
    """build_node stays compilable with run_tests unset — the builder still runs, no test agent."""
    build_calls: list[str] = []
    runtime = LangGraphRuntime(run_spec=_record([]),
                               run_build=_record(build_calls))   # no run_tests
    runtime.dispatch("run-1")
    runtime.resume_for_decision("run-1", "functional", "approve")
    runtime.resume_for_decision("run-1", "technical_design", "approve")

    assert build_calls == ["run-1"]


def test_dod_green_routes_to_await_merge_gate():
    runtime = LangGraphRuntime(run_spec=_record([]))
    _advance_to(runtime, "run-1", stop="await_dod")
    runtime.resume_for_dod("run-1", "green")

    snap = runtime.state("run-1")
    assert snap.next == ("await_merge_gate",)
    assert snap.values.get("last_dod_status") == "green"


def test_dod_red_ends_the_graph():
    """A red DoD ends the run — M2 has no "fix and retry" path (M3 may add one). The projection
    records the failure independently from the ``dod.red`` event the CI poller emits."""
    runtime = LangGraphRuntime(run_spec=_record([]))
    _advance_to(runtime, "run-1", stop="await_dod")
    runtime.resume_for_dod("run-1", "red")

    assert runtime.state("run-1").next == ()


def test_dod_unknown_status_ends_the_graph_defensively():
    """Defensive: an unrecognised status doesn't advance through to a merge gate (no silent
    "approve by ambiguity"). The route_after_dod default-case is deliberate."""
    runtime = LangGraphRuntime(run_spec=_record([]))
    _advance_to(runtime, "run-1", stop="await_dod")
    runtime.resume_for_dod("run-1", "unknown")

    assert runtime.state("run-1").next == ()


def test_approve_merge_gate_runs_merge_exec_and_ends():
    """The full M2 happy path through the topology. ``run_merge`` is the seam where a later slice
    wires ``GitHubAdapter.merge`` (ADR-0016 boundary — the execution half; M0+M1 proved refusal)."""
    merge_calls: list[str] = []
    runtime = LangGraphRuntime(run_spec=_record([]),
                               run_merge=_record(merge_calls))
    _advance_to(runtime, "run-1", stop="await_merge_gate")
    runtime.resume_for_decision("run-1", "technical_merge", "approve")

    assert merge_calls == ["run-1"]
    assert runtime.state("run-1").next == ()


def test_request_changes_on_merge_gate_re_runs_build_node():
    """The architect saw the implementation and wants a different one — loop back to **build**,
    not design. Mirrors the M1 design-gate loop, one step further down the chain. The builder
    re-runs and re-opens the merge gate when DoD goes green again."""
    build_calls: list[str] = []
    runtime = LangGraphRuntime(run_spec=_record([]),
                               run_build=_record(build_calls))
    _advance_to(runtime, "run-1", stop="await_merge_gate")
    runtime.resume_for_decision("run-1", "technical_merge", "request_changes")

    snap = runtime.state("run-1")
    assert snap.next == ("await_dod",)               # build ran again, paused at the next DoD wait
    assert build_calls == ["run-1", "run-1"]         # ran once on first build, again on re-build


def test_reject_on_merge_gate_ends_the_graph():
    runtime = LangGraphRuntime(run_spec=_record([]))
    _advance_to(runtime, "run-1", stop="await_merge_gate")
    runtime.resume_for_decision("run-1", "technical_merge", "reject")

    assert runtime.state("run-1").next == ()


def test_merge_exec_node_stubs_when_run_merge_not_wired():
    """``run_merge`` is optional through M2 #3 — the topology compiles and the graph reaches END
    even without a real merge adapter wired. The ADR-0016 boundary lives **inside** the adapter
    that ``run_merge`` will eventually call; the node itself just dispatches."""
    runtime = LangGraphRuntime(run_spec=_record([]))   # no run_merge
    _advance_to(runtime, "run-1", stop="await_merge_gate")
    runtime.resume_for_decision("run-1", "technical_merge", "approve")

    assert runtime.state("run-1").next == ()


def test_dod_resume_carries_through_to_state():
    """Like the gate-decision carry-through — the DoD status lands in the graph state for
    observability. The routing fn reads only ``status``; this asserts the seam."""
    runtime = LangGraphRuntime(run_spec=_record([]))
    _advance_to(runtime, "run-1", stop="await_dod")
    runtime.resume_for_dod("run-1", "green")

    snap = runtime.state("run-1")
    assert snap.values.get("last_dod_status") == "green"
    # The merge-gate suspend hasn't yet carried a ``last_decision`` for the merge gate — that lands
    # on the next resume_for_decision. Carry of the previous gate's value is the M1 invariant we
    # don't disturb here.
    assert snap.values.get("last_gate_type") == "technical_design"


# --- US-0024 H2: drain mode / kill switch -------------------------------------------------------


def test_drain_switch_toggles():
    switch = DrainSwitch()
    assert switch.drained is False
    switch.drain()
    assert switch.drained is True
    switch.resume()
    assert switch.drained is False


def test_async_dispatcher_skips_kick_while_drained():
    """The kill switch stops new agent work: while drained, the async dispatcher does not submit
    the graph run (returns None). The ``task.dispatched`` event has already landed upstream — the
    run is recoverable from the log once drain lifts."""
    spec_calls: list[str] = []
    runtime = LangGraphRuntime(run_spec=_record(spec_calls))
    switch = DrainSwitch()
    with ThreadPoolExecutor(max_workers=2) as executor:
        dispatch = make_async_dispatcher(runtime, executor, drain=switch)

        switch.drain()
        assert dispatch("run-1") is None                   # skipped — no work submitted

        switch.resume()
        fut = dispatch("run-2")
        assert fut is not None
        fut.result(timeout=5)

    assert spec_calls == ["run-2"]                          # only the un-drained dispatch ran


def test_async_resumer_skips_kick_while_drained():
    spec_calls: list[str] = []
    runtime = LangGraphRuntime(run_spec=_record(spec_calls))
    switch = DrainSwitch()
    with ThreadPoolExecutor(max_workers=2) as executor:
        dispatch = make_async_dispatcher(runtime, executor)
        resume = make_async_resumer(runtime, executor, drain=switch)
        dispatch("run-1").result(timeout=5)                # suspends at functional gate

        switch.drain()
        assert resume("run-1", "functional", "approve") is None   # resume skipped while drained
        assert runtime.state("run-1").next == ("await_functional_gate",)   # did not advance

        switch.resume()
        resume("run-1", "functional", "approve").result(timeout=5)
    assert runtime.state("run-1").next == ("await_design_gate",)   # advanced once un-drained
