"""The read-API service core (ADR-0018) — the status×content×where join, and per-product isolation.

Isolation is the security-relevant behaviour: a caller must never receive a product they don't
participate in, and the boundary must not even reveal that product's existence (ADR-0010/0011/0019).
"""
import pytest

from orchestrator.readapi import Degraded, NotFound, ReadAPI, Unauthenticated
from orchestrator.register import Participant, Product, Register

ARCH = "arch@example.com"
OUTSIDER = "nobody@example.com"
REPO = "acme/widget"


def _spec(feature, kind, task=None, title="A doc"):
    t = f"\n  task: {task}" if task else ""
    return (f"---\ntitle: {title}\nmaestro:\n  feature: {feature}\n  kind: {kind}{t}\n---\n"
            f"# {title}\nbody of {feature}")


@pytest.fixture
def register():
    """Two products; the architect (by email) participates only in 'maestro' — 'secret' must stay hidden."""
    return Register(products={
        "maestro": Product(id="maestro", name="maestro", product_type="technical", visibility="public",
                           repos=(REPO,),
                           participants=(Participant(handle="@arch", role="architect", email=ARCH),)),
        "secret": Product(id="secret", name="Secret", product_type="commercial", visibility="private",
                          repos=("acme/secret",),
                          participants=(Participant(handle="@other", role="architect",
                                                    email="other@example.com"),)),
    })


@pytest.fixture
def api(register, events, content_reader):
    content_reader.put(REPO, "main", "docs/spec.md", _spec("invoice-export", "functional_spec", "US-0042"))
    return ReadAPI(register, events, content_reader)


# --- identity + isolation ----------------------------------------------------------------------

def test_list_products_scopes_to_membership(api):
    assert api.list_products(ARCH) == [
        {"id": "maestro", "name": "maestro", "product_type": "technical", "role": "architect"}]


def test_outsider_sees_no_products(api):
    assert api.list_products(OUTSIDER) == []


def test_no_identity_is_unauthenticated(api):
    with pytest.raises(Unauthenticated):
        api.list_products("")


def test_isolation_hides_other_products_as_404(api):
    # 'secret' exists but the caller isn't a member — must be 404 (not 403), revealing nothing.
    with pytest.raises(NotFound):
        api.list_specs(ARCH, "secret")
    with pytest.raises(NotFound):
        api.get_spec(ARCH, "secret", "anything", "functional_spec")


# --- the specs index ---------------------------------------------------------------------------

def test_list_specs_renders_main_spec_with_null_status(api):
    out = api.list_specs(ARCH, "maestro")
    assert out["product"]["id"] == "maestro"
    [spec] = out["specs"]
    assert spec["feature"] == "invoice-export" and spec["kind"] == "functional_spec"
    assert spec["task"] == "US-0042" and spec["availability"] == "indexed"
    assert spec["status"] is None  # no delivery task owns a doc sitting on main
    assert spec["href"] == (
        "/api/products/maestro/specs/invoice-export/functional_spec?branch=main")


def test_list_specs_joins_status_for_a_branch_with_an_open_pr(register, events, content_reader):
    # A delivery task with an open PR on maestro/feat, and its design lives on that branch.
    events.append(run_id="t1", actor="@arch", type="branch.created", target=f"{REPO}:maestro/feat",
                  payload={"repo": REPO, "branch": "maestro/feat"})
    events.append(run_id="t1", actor="@arch", type="pr.opened", target=f"{REPO}#7",
                  payload={"repo": REPO, "branch": "maestro/feat", "pr_number": 7, "pr_url": "u"})
    events.append(run_id="t1", actor="@arch", type="gate.resolved", target=f"{REPO}#7",
                  payload={"gate": "technical_design", "decision": {"decision": "approve", "by": "@arch"}})
    content_reader.put(REPO, "maestro/feat", "docs/design.md", _spec("widget-x", "technical_design"))
    api = ReadAPI(register, events, content_reader)

    specs = {s["feature"]: s for s in api.list_specs(ARCH, "maestro")["specs"]}
    st = specs["widget-x"]["status"]
    assert st["task_id"] == "t1" and st["branch"] == "maestro/feat" and st["stage"] == "merge_gate"
    assert st["gate"] == {"type": "technical", "decision": "approve"}
    assert st["merged"] is False


def test_index_cache_avoids_refetch_until_the_branch_changes(api, content_reader):
    api.list_specs(ARCH, "maestro")
    after_first = content_reader.reads
    assert after_first > 0
    api.list_specs(ARCH, "maestro")              # same head commit → served from cache
    assert content_reader.reads == after_first   # no new content fetches
    # a new commit on the branch (content change) invalidates the cached index → one refetch
    content_reader.put(REPO, "main", "docs/spec.md", _spec("invoice-export", "functional_spec", "US-0042", "Edited"))
    api.list_specs(ARCH, "maestro")
    assert content_reader.reads > after_first


def test_blob_cache_skips_unchanged_files_across_rebuilds(api, content_reader):
    api.list_specs(ARCH, "maestro")
    base = content_reader.reads
    # Add a second doc → the branch head changes, so the index rebuilds; but the unchanged first doc's
    # blob is already cached, so only the new file is fetched.
    content_reader.put(REPO, "main", "docs/two.md", _spec("second", "technical_design"))
    api.list_specs(ARCH, "maestro")
    assert content_reader.reads == base + 1      # only the new blob fetched, not both


def test_list_specs_filters(api, content_reader):
    content_reader.put(REPO, "main", "docs/design.md", _spec("invoice-export", "technical_design"))
    assert len(api.list_specs(ARCH, "maestro")["specs"]) == 2
    only = api.list_specs(ARCH, "maestro", kind="technical_design")["specs"]
    assert [s["kind"] for s in only] == ["technical_design"]


def test_list_specs_surfaces_unindexed(api, content_reader):
    content_reader.put(REPO, "main", "docs/bad.md", _spec("bad", "not-a-kind"))
    out = api.list_specs(ARCH, "maestro")
    assert [u["reason"] for u in out["unindexed"]] == ["malformed maestro: frontmatter (kind)"]


# --- one rendered doc --------------------------------------------------------------------------

def test_get_spec_returns_content_and_frontmatter(api):
    doc = api.get_spec(ARCH, "maestro", "invoice-export", "functional_spec")
    assert doc["title"] == "A doc"
    assert "body of invoice-export" in doc["content"]
    assert doc["frontmatter"]["maestro"]["feature"] == "invoice-export"
    assert doc["ref"]["path"] == "docs/spec.md" and doc["ref"]["commit"].startswith("blob-")


def test_get_spec_unknown_is_404(api):
    with pytest.raises(NotFound):
        api.get_spec(ARCH, "maestro", "does-not-exist", "functional_spec")


def test_get_spec_unknown_kind_is_404(api):
    with pytest.raises(NotFound):
        api.get_spec(ARCH, "maestro", "invoice-export", "bogus_kind")


def test_get_spec_content_fetch_failure_is_degraded(register, events):
    """Indexed at scan time, but the dedicated content re-fetch fails → 503 degraded (retryable)."""
    class FlakyReader:
        def __init__(self):
            self.calls = 0
        def head_sha(self, repo, ref):
            return "c0ffee" if ref == "main" else (_ for _ in ()).throw(FileNotFoundError(ref))
        def list_tree_entries(self, repo, ref, path_prefix=""):
            return [("docs/spec.md", "blob-1")] if ref == "main" else []
        def get_contents(self, repo, path, ref):
            self.calls += 1
            if self.calls > 1:  # the index-build read succeeds; the detail re-fetch fails
                raise RuntimeError("transient upstream error")
            return {"content": _spec("invoice-export", "functional_spec"), "sha": "blob-1", "path": path}

    api = ReadAPI(register, events, FlakyReader())
    with pytest.raises(Degraded):
        api.get_spec(ARCH, "maestro", "invoice-export", "functional_spec")


# --- per-task detail ---------------------------------------------------------------------------

def _dispatch(events, run_id, product_id="maestro", repo=REPO):
    events.append(run_id=run_id, actor="@arch", type="task.dispatched", target=f"task:{run_id}",
                  payload={"task_id": run_id, "product_id": product_id, "repo": repo,
                           "intent": "do the thing"})


def test_get_task_returns_projected_state(api, events):
    _dispatch(events, "run-9c2e3f")
    out = api.get_task(ARCH, "maestro", "run-9c2e3f")
    assert out == {"task_id": "run-9c2e3f", "product_id": "maestro", "stage": "intake",
                   "status": "active", "branch": None, "pr": None, "merged": False, "gates": []}


def test_get_task_unknown_is_404(api):
    with pytest.raises(NotFound):
        api.get_task(ARCH, "maestro", "no-such-task")


def test_get_task_outsider_sees_no_task_as_404(api, events):
    # The task exists, but the caller isn't a participant in any product → 404 (existence hidden).
    _dispatch(events, "run-secret")
    with pytest.raises(NotFound):
        api.get_task(OUTSIDER, "maestro", "run-secret")


def test_get_task_wrong_product_id_is_404(register, events, content_reader):
    # The caller participates in BOTH products (so _authorize_product passes for either URL); the
    # task belongs to 'maestro'. A request against 'secret' for the same task must still 404 —
    # otherwise URL-guessing would enumerate tasks across products the caller co-participates in.
    from orchestrator.register import Participant
    secret = register.products["secret"]
    register.products["secret"] = type(secret)(
        id=secret.id, name=secret.name, product_type=secret.product_type, visibility=secret.visibility,
        repos=secret.repos,
        participants=secret.participants + (Participant(handle="@arch", role="architect", email=ARCH),),
    )
    api = ReadAPI(register, events, content_reader)
    _dispatch(events, "run-x")                                          # dispatched into maestro
    assert api.get_task(ARCH, "maestro", "run-x")["product_id"] == "maestro"
    with pytest.raises(NotFound):
        api.get_task(ARCH, "secret", "run-x")


def test_get_task_with_gates_renders_decisions(api, events):
    _dispatch(events, "run-g")
    events.append(run_id="run-g", actor="@arch", type="gate.resolved", target="task:run-g",
                  payload={"gate": "functional", "decision": {"decision": "approve", "by": "@arch"}})
    out = api.get_task(ARCH, "maestro", "run-g")
    [g] = out["gates"]
    assert g["gate"] == "functional" and g["decision"] == "approve" and g["resolved_by"] == "@arch"
    assert isinstance(g["resolved_at"], float) and g["seq"] >= 1
