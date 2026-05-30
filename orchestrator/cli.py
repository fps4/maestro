"""maestro CLI — boot the engine and exercise the M0 spine.

  maestro boot [--probe]        boot + report connection status (--probe makes the live calls)
  maestro selftest              boot, make one real ModelClient call, show the recorded audit row
  maestro verify-chain          confirm the event log's hash chain is intact (ADR-0009)
  maestro serve [--host --port] serve the workspace read API (S1, read-only — ADR-0018)

``--example`` lets a local run fall back to config/products.example.yaml when the private register is
absent (ADR-0010). Real runs use config/products.yaml.
"""
import argparse
import os
import sys

from orchestrator import db
from orchestrator.boot import StartupError, boot
from orchestrator.eventlog import ChainBroken, EventLog


def _print_connections(engine) -> None:
    glyph = {True: "✓", False: "✗", None: "–"}
    print("connections:")
    for c in engine.connections:
        print(f"  {glyph[c.ok]} {c.name:<10} {c.detail}")


def cmd_boot(a) -> int:
    try:
        engine = boot(probe=a.probe, allow_example_register=a.example)
    except StartupError as exc:
        print(f"✗ startup refused: {exc}", file=sys.stderr)
        return 1
    print(f"✓ maestro booted — {len(engine.register.products)} product(s) in the register")
    _print_connections(engine)
    return 0


def cmd_selftest(a) -> int:
    try:
        engine = boot(probe=False, allow_example_register=a.example)
    except StartupError as exc:
        print(f"✗ startup refused: {exc}", file=sys.stderr)
        return 1
    res = engine.model.complete(agent="selftest", run_id="selftest", tier="fast",
                                prompt="Reply with the single word: ok", max_tokens=16)
    rows = engine.audit.read("selftest")
    print(f"✓ ModelClient call recorded — model={res.call.model} "
          f"in={res.call.input_tokens} out={res.call.output_tokens} "
          f"cost=${res.call.cost_usd} {res.call.latency_ms}ms")
    print(f"  audit rows for run 'selftest': {len(rows)}")
    print(f"  completion: {res.text[:80]!r}")
    return 0


def cmd_verify_chain(a) -> int:
    conn = db.connect(a.db)
    try:
        EventLog(conn).verify_chain()
    except ChainBroken as exc:
        print(f"✗ event log chain BROKEN: {exc}", file=sys.stderr)
        return 1
    n = conn.execute("SELECT count(*) AS n FROM events").fetchone()["n"]
    print(f"✓ event log chain intact — {n} event(s)")
    return 0


def cmd_serve(a) -> int:
    """Serve the workspace API — read (S1) + write (S2/S3 + M1 dispatch).

    Two modes:

    * **contract-only (default)** — no LLM, no merge adapter; the API serves reads and accepts
      writes that land in the event log only. The engine stream (LangGraph) is not attached, so a
      ``task.dispatched`` event does not produce a spec, and a ``gate.decided`` does not resume
      anything. This is the M0 serve shape, still useful for the workspace UI slice (#10) which
      can develop against the contract surface alone.
    * **--engine** — additionally constructs the LangGraph runtime (ADR-0014), the
      :class:`ModelClient` (ADR-0002), the GitHub adapter (ADR-0016), and wires the
      ``dispatcher`` / ``resumer`` hooks into the write API. A dispatched task triggers the spec
      agent, a gate decision resumes the suspended graph. Requires ``ANTHROPIC_API_KEY`` and
      ``GITHUB_TOKEN``.
    """
    from concurrent.futures import ThreadPoolExecutor

    from adapters.github.adapter import GitHubAdapter
    from adapters.github.http_client import HttpGitHubClient
    from model.audit import LLMAudit
    from model.client import ModelClient
    from orchestrator.httpserver import serve
    from orchestrator.idempotency import IdempotencyStore
    from orchestrator.readapi import ReadAPI
    from orchestrator.register import load_register
    from orchestrator.routing import RoutingResolver
    from orchestrator.writeapi import WriteAPI

    try:
        register = load_register(allow_example=a.example)
    except FileNotFoundError as exc:
        print(f"✗ {exc}", file=sys.stderr)
        return 1
    routing = RoutingResolver.load()

    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        print("• no GITHUB_TOKEN — unauthenticated GitHub reads (public repos only, rate-limited)")
    default_branch = os.environ.get("MAESTRO_DEFAULT_BRANCH", "main")

    # A dedicated, cross-thread-tolerant connection: the API serves from request threads
    # (ThreadingHTTPServer), so it cannot share a single-threaded write connection (ADR-0008).
    # The read API uses its own read lock; the write API has its own write lock. One conn, two locks.
    db_path = a.db
    conn = db.connect(db_path, check_same_thread=False)
    events = EventLog(conn)
    # The ArtifactStore backs the US-0033 artefact endpoint (302 → presigned URL). Defaults to the
    # in-memory backend; a real deploy sets the instance MinIO block (ADR-0012 / Q4) — that config
    # wiring lands with the first artefact emitter (no producer stores artefacts yet in this slice).
    from storage import load_artifact_store_config, make_store
    store = make_store(load_artifact_store_config(None))
    read = ReadAPI(register, events, HttpGitHubClient(token), default_branch=default_branch,
                   store=store)

    dispatcher = resumer = None
    if a.engine:
        if not token:
            print("✗ --engine requires GITHUB_TOKEN (the spec agent commits artefacts).",
                  file=sys.stderr)
            return 1
        if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("MAESTRO_MODEL_BASE_URL")):
            print("✗ --engine requires ANTHROPIC_API_KEY (the spec agent calls the ModelClient).",
                  file=sys.stderr)
            return 1
        from langgraph.checkpoint.sqlite import SqliteSaver

        from orchestrator.agents.design import run_design_for_run
        from orchestrator.agents.impl import run_impl_for_run
        from orchestrator.agents.spec import run_spec_for_run
        from orchestrator.agents.testgen import run_testgen_for_run
        from orchestrator.runtime import (
            LangGraphRuntime,
            make_async_dispatcher,
            make_async_resumer,
        )

        audit = LLMAudit(conn)
        model = ModelClient(audit)
        github_client = HttpGitHubClient(token)
        github_adapter = GitHubAdapter(events, register, routing, github_client)

        def _spec(run_id: str) -> None:
            run_spec_for_run(run_id, events=events, register=register,
                              model=model, github=github_adapter)

        def _design(run_id: str) -> None:
            run_design_for_run(run_id, events=events, register=register,
                                model=model, github=github_adapter)

        def _build(run_id: str) -> None:
            # The builder reads the approved design + spec content through the same GitHub client
            # the read API uses (reader=), and writes commits + the draft PR through the adapter.
            run_impl_for_run(run_id, events=events, register=register, model=model,
                             github=github_adapter, reader=github_client,
                             base_branch=default_branch)

        def _testgen(run_id: str) -> None:
            # The test agent runs right after the builder (same build_node): it reads the approved
            # spec + the builder's committed implementation through the reader and commits
            # spec-derived tests onto the same branch, so the open PR carries them (US-0014 / Q2).
            run_testgen_for_run(run_id, events=events, register=register, model=model,
                                github=github_adapter, reader=github_client)

        # The checkpointer lives in the same SQLite file as the event log (ADR-0008 / ADR-0014):
        # one DB to back up, langgraph's tables sit alongside ours by name. A future Postgres
        # cutover (concurrency-driven, ADR-0008) moves both at once.
        checkpoint_path = db_path or ":memory:"
        checkpoint_conn = SqliteSaver.from_conn_string(checkpoint_path).__enter__()
        runtime = LangGraphRuntime(run_spec=_spec, run_design=_design, run_build=_build,
                                    run_tests=_testgen, checkpointer=checkpoint_conn)

        # Background pool so dispatch/resume don't block the HTTP request. Workers > 1 so a slow
        # spec call doesn't wedge subsequent decisions on other tasks; each task's own lock inside
        # the runtime serialises per thread_id, so concurrent runs on different tasks are safe.
        engine_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="maestro-engine")
        dispatcher = make_async_dispatcher(runtime, engine_pool)
        resumer = make_async_resumer(runtime, engine_pool)
        print(f"✓ engine: LangGraph runtime + spec/design/impl/testgen agents wired "
              f"(checkpointer={checkpoint_path})")

    write = WriteAPI(register, events, routing, IdempotencyStore(conn),
                     dispatcher=dispatcher, resumer=resumer)
    surface = "read+write+engine" if a.engine else "read+write"
    print(f"✓ workspace API ({surface}) — {len(register.products)} product(s); "
          f"default branch {default_branch!r}")
    serve(read, write, host=a.host, port=a.port)
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="maestro")
    p.add_argument("--example", action="store_true",
                   help="allow falling back to config/products.example.yaml")
    sub = p.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("boot"); b.add_argument("--probe", action="store_true")
    b.set_defaults(fn=cmd_boot)

    s = sub.add_parser("selftest"); s.set_defaults(fn=cmd_selftest)

    v = sub.add_parser("verify-chain"); v.add_argument("--db", default=None)
    v.set_defaults(fn=cmd_verify_chain)

    sv = sub.add_parser("serve")
    sv.add_argument("--host", default="127.0.0.1")
    sv.add_argument("--port", type=int, default=8800)
    sv.add_argument("--db", default=None,
                    help="path to the SQLite event log + LLM audit + langgraph checkpoint DB")
    sv.add_argument("--engine", action="store_true",
                    help="wire the LangGraph runtime + spec agent — requires GITHUB_TOKEN and "
                         "ANTHROPIC_API_KEY (ADR-0014)")
    sv.set_defaults(fn=cmd_serve)

    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
