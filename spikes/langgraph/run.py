"""CLI driver for the LangGraph delivery-loop spike.

  python run.py start  --intent "add OAuth login" [--product-type technical|commercial]
  python run.py resume --thread <id> --decision approve|request_changes|reject [--feedback "..."]
  python run.py state  --thread <id>

State is checkpointed to .run/checkpoints.sqlite, so `start` and `resume` can run in separate
processes — demonstrating durable resume across restarts.
"""
import argparse
import json
import pathlib
import uuid

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command

from delivery_loop import make_graph
from event_log import EventLog
from model_client import ModelClient

RUN = pathlib.Path(__file__).parent / ".run"
RUN.mkdir(exist_ok=True)
DB = RUN / "checkpoints.sqlite"
EVENTS = RUN / "events.jsonl"
AUDIT = RUN / "llm_audit.jsonl"


def _run(fn):
    events, model = EventLog(EVENTS), ModelClient(AUDIT)
    with SqliteSaver.from_conn_string(str(DB)) as cp:
        return fn(make_graph(cp, model, events))


def _show(result):
    intr = result.get("__interrupt__") if isinstance(result, dict) else None
    if intr:
        print("\n⏸  GATE — awaiting a human decision\n")
        print(json.dumps(intr[0].value, indent=2))
        print("\nresume:  python run.py resume --thread <id> --decision approve|request_changes|reject")
    else:
        print(f"\n✓ run complete — stage={result.get('stage')} pr={result.get('pr_url')}")


def start(a):
    thread = a.thread or uuid.uuid4().hex[:8]
    cfg = {"configurable": {"thread_id": thread}}
    print(f"thread_id = {thread}")
    _run(lambda g: _show(g.invoke(
        {"run_id": thread, "intent": a.intent, "product_type": a.product_type, "history": []}, cfg)))


def resume(a):
    cfg = {"configurable": {"thread_id": a.thread}}
    val = {"decision": a.decision, "by": a.by, "feedback": a.feedback}
    _run(lambda g: _show(g.invoke(Command(resume=val), cfg)))


def state(a):
    cfg = {"configurable": {"thread_id": a.thread}}
    snap = _run(lambda g: g.get_state(cfg))
    print("paused_at:", snap.next or "(done)")
    print("values:", json.dumps({k: v for k, v in snap.values.items() if k != "history"},
                                 indent=2, default=str))
    if EVENTS.exists():
        print("\nevent log (maestro source of truth — separate from the checkpointer):")
        for line in EVENTS.read_text().splitlines():
            e = json.loads(line)
            print(f"  #{e['seq']:>2} {e['type']:<18} {json.dumps(e['payload'])}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("start"); s.add_argument("--intent", required=True)
    s.add_argument("--product-type", dest="product_type", default="technical")
    s.add_argument("--thread"); s.set_defaults(fn=start)

    r = sub.add_parser("resume"); r.add_argument("--thread", required=True)
    r.add_argument("--decision", required=True, choices=["approve", "request_changes", "reject"])
    r.add_argument("--by", default="@farid"); r.add_argument("--feedback", default=None)
    r.set_defaults(fn=resume)

    st = sub.add_parser("state"); st.add_argument("--thread", required=True); st.set_defaults(fn=state)

    args = p.parse_args()
    args.fn(args)
