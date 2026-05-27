"""maestro CLI — boot the engine and exercise the M0 spine.

  maestro boot [--probe]        boot + report connection status (--probe makes the live calls)
  maestro selftest              boot, make one real ModelClient call, show the recorded audit row
  maestro verify-chain          confirm the event log's hash chain is intact (ADR-0009)
  maestro serve [--port]        serve the workspace read API (S1, read-only — ADR-0018)

``--example`` lets a local run fall back to config/products.example.yaml when the private register is
absent (ADR-0010). Real runs use config/products.yaml.
"""
import argparse
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
    try:
        engine = boot(probe=False, allow_example_register=a.example)
    except StartupError as exc:
        print(f"✗ startup refused: {exc}", file=sys.stderr)
        return 1
    if engine.github_client is None:
        print("✗ serve needs GITHUB_TOKEN — the read API fetches repo content (ADR-0018)",
              file=sys.stderr)
        return 1
    from orchestrator.httpserver import serve
    from orchestrator.readapi import ReadAPI
    # A dedicated, read-only connection: the API serves from request threads (ThreadingHTTPServer),
    # so it must not share the engine's single-threaded write connection (ADR-0008).
    read_conn = db.connect(check_same_thread=False)
    api = ReadAPI(engine.register, EventLog(read_conn), engine.github_client)
    serve(api, host=a.host, port=a.port)
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
    sv.set_defaults(fn=cmd_serve)

    args = p.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
