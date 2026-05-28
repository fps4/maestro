"""The workspace read API — the orchestrator's first HTTP surface (ADR-0018), S1: read-only.

This is the **framework-agnostic core** of the contract in
``docs/architecture/contracts/workspace-read-api.md``. It performs the join the workspace renders —
**status** (the event-log projection, ``projection.py``) × **content** (the repo, as-committed, via a
:class:`~orchestrator.specindex.RepoContentReader`) × **where** (the frontmatter :mod:`spec index
<orchestrator.specindex>`) — and enforces **per-product isolation server-side** (ADR-0010/0011): a
caller only ever sees products they participate in, matched by identity through the register (ADR-0019).

It holds no GitHub token and no authoritative state (ADR-0015). The HTTP binding lives in
:mod:`orchestrator.httpserver`; keeping the logic here means it is tested with no sockets and no network.

**S1 scope of the status join.** A spec's status is the delivery task working on the *same repo+branch*
(the task's open PR, from the projection). Specs on the default branch, or branches with no task yet,
carry ``status: null`` — honest for the dogfood slice. The precise ``feature → run_id`` link arrives
with crew events that record the producing ref (ADR-0018); this layers on without changing the contract.
"""
import threading
from typing import Optional
from urllib.parse import quote

from orchestrator.projection import GateDecision, TaskState, project, project_task
from orchestrator.register import Register
from orchestrator.specindex import (
    KINDS,
    KIND_FUNCTIONAL,
    BranchIndex,
    IndexedSpec,
    RepoContentReader,
    SpecRef,
    build_branch_index,
    parse_frontmatter,
)


class APIError(Exception):
    """Base for read-API errors — carries a stable ``code`` and HTTP ``status`` for the binding."""
    code = "error"
    status = 500

    def __init__(self, message: str = "", ref: Optional[dict] = None):
        self.message = message or self.code
        self.ref = ref
        super().__init__(self.message)


class Unauthenticated(APIError):
    code = "unauthenticated"
    status = 401


class NotFound(APIError):
    """Unknown product *to this caller* (isolation: existence not revealed) or unknown spec."""
    code = "not_found"
    status = 404


class Degraded(APIError):
    """An upstream content fetch failed on a detail call — retryable (``standards/reliability.yaml``)."""
    code = "degraded"
    status = 503


class ReadAPI:
    def __init__(self, register: Register, events, content: RepoContentReader,
                 default_branch: str = "main"):
        self._register = register
        self._events = events
        self._content = content
        self._default_branch = default_branch
        self._read_lock = threading.Lock()  # serialise event-log reads across request threads
        # Index cache: rebuild a branch's index only when its head commit changes — not per request.
        # Blob cache: content-addressed frontmatter, shared across branches/rebuilds. The webhook `push`
        # reconciler (ADR-0017) will keep these fresh incrementally; for now the head-SHA check does.
        self._index_cache: dict[tuple[str, str], tuple[str, BranchIndex]] = {}
        self._blob_cache: dict[str, object] = {}
        self._index_lock = threading.Lock()

    # --- endpoints ------------------------------------------------------------------------------

    def list_products(self, identity: str) -> list[dict]:
        """``GET /api/products`` — the caller's products (register membership)."""
        self._require_identity(identity)
        out = []
        for p in self._register.products_for(identity):
            part = p.participant_for(identity)
            out.append({"id": p.id, "name": p.name, "product_type": p.product_type,
                        "role": part.role if part else None})
        return out

    def list_specs(self, identity: str, product_id: str, *, branch: Optional[str] = None,
                   kind: Optional[str] = None, feature: Optional[str] = None) -> dict:
        """``GET /api/products/{id}/specs`` — the Specs index: where × status × availability."""
        product = self._authorize_product(identity, product_id)
        status_map = self._status_map()
        specs: list[dict] = []
        unindexed: list[dict] = []
        for repo in product.repos:
            for b in self._branches(repo, status_map):
                if branch and b != branch:
                    continue
                try:
                    idx = self._branch_index(repo, b)
                except Exception:
                    continue  # a branch that cannot be listed yields nothing; the rest still serve
                task = status_map.get((repo, b))
                specs += [self._summary(product_id, s, task) for s in idx.specs]
                unindexed += [{"ref": _ref_json(u.ref), "reason": u.reason} for u in idx.unindexed]
        if kind:
            specs = [s for s in specs if s["kind"] == kind]
        if feature:
            specs = [s for s in specs if s["feature"] == feature]
        return {"product": {"id": product.id, "name": product.name},
                "specs": specs, "unindexed": unindexed}

    def get_task(self, identity: str, product_id: str, task_id: str) -> dict:
        """``GET /api/products/{product_id}/tasks/{task_id}`` — one task's projected state.

        The status side of the workspace contract (workspace-read-api.md): the same projection the
        Specs index joins against (``projection.project_task``), now addressable by task. Per-product
        isolation is enforced twice (ADR-0010/0011): the URL's product must be visible to the caller
        (404 otherwise), **and** it must match the task's actual product (404 otherwise) — a caller
        cannot enumerate other-product tasks by guessing ids inside a product they DO participate in.
        """
        product = self._authorize_product(identity, product_id)
        with self._read_lock:                       # same single DB touch as the status join
            raw = self._events.read(run_id=task_id)
        if not raw:
            raise NotFound(f"task {task_id!r} not found")
        task = project_task(raw, task_id)
        if task is None:                            # defensive: events exist but projection is empty
            raise NotFound(f"task {task_id!r} not found")
        actual_product_id = self._task_product_id(raw, task)
        if actual_product_id != product.id:
            # The URL's product doesn't own this task. 404 (not 403) — never reveal existence.
            raise NotFound(f"task {task_id!r} not found")
        return {
            "task_id": task.task_id,
            "product_id": product.id,
            "stage": task.stage,
            "status": task.status,
            "branch": task.branch,
            "pr": task.pr,
            "merged": task.merged,
            "gates": [_gate_json(g) for g in task.gates],
        }

    def get_spec(self, identity: str, product_id: str, feature: str, kind: str,
                 branch: Optional[str] = None) -> dict:
        """``GET /api/products/{id}/specs/{feature}/{kind}`` — one rendered doc + status."""
        product = self._authorize_product(identity, product_id)
        if kind not in KINDS:
            raise NotFound(f"unknown kind {kind!r}")
        target = branch or self._default_branch
        for repo in product.repos:
            try:
                idx = self._branch_index(repo, target)
            except Exception:
                continue
            spec = next((s for s in idx.specs if s.feature == feature and s.kind == kind), None)
            if spec is None:
                continue
            try:
                obj = self._content.get_contents(repo, spec.ref.path, target)
            except Exception:
                raise Degraded(f"content fetch failed for {spec.ref.path}", ref=_ref_json(spec.ref))
            meta, _ = parse_frontmatter(obj.get("content", ""))
            task = self._status_map().get((repo, target))
            ref = SpecRef(repo, target, spec.ref.path, obj.get("sha", spec.ref.commit))
            return {"feature": spec.feature, "task": spec.task, "kind": spec.kind,
                    "title": spec.title, "ref": _ref_json(ref), "frontmatter": meta or {},
                    "content": obj.get("content", ""),
                    "status": _status(task, spec.kind) if task else None}
        raise NotFound(f"no {kind} for feature {feature!r} on branch {target!r}")

    # --- isolation + identity -------------------------------------------------------------------

    @staticmethod
    def _require_identity(identity: str) -> None:
        if not identity:
            raise Unauthenticated("no caller identity")

    def _authorize_product(self, identity: str, product_id: str):
        """Resolve the product *and* the caller's membership in one step. Unknown-to-caller → 404
        (existence is not revealed — ADR-0010/0011), never 403."""
        self._require_identity(identity)
        product = self._register.product(product_id)
        if product is None or product.participant_for(identity) is None:
            raise NotFound(f"product {product_id!r} not found")
        return product

    def _task_product_id(self, events: list[dict], task: TaskState) -> Optional[str]:
        """The product that owns this task. ``task.dispatched`` carries it explicitly (write API);
        for tasks that pre-date dispatch (or tests injecting only branch/pr events), fall back to
        the repo on the projected PR matched against the register."""
        for e in events:
            if e["type"] == "task.dispatched":
                pid = (e.get("payload") or {}).get("product_id")
                if pid:
                    return pid
        if task.pr and task.pr.get("repo"):
            owner = self._register.product_for_repo(task.pr["repo"])
            if owner is not None:
                return owner.id
        for e in events:
            payload = e.get("payload") or {}
            repo = payload.get("repo")
            if repo:
                owner = self._register.product_for_repo(repo)
                if owner is not None:
                    return owner.id
        return None

    # --- the spec index (cached) ----------------------------------------------------------------

    def _branch_index(self, repo: str, branch: str) -> BranchIndex:
        """A branch's index, rebuilt only when its head commit changes. One cheap ``head_sha`` call
        revalidates the cache (vs. re-scanning every file per request); the build reuses the shared
        blob cache, so only changed files are ever fetched. Raises if the branch can't be resolved."""
        head = self._content.head_sha(repo, branch)   # raises for an unknown branch → caller handles
        key = (repo, branch)
        with self._index_lock:
            hit = self._index_cache.get(key)
            if hit and hit[0] == head:
                return hit[1]
        idx = build_branch_index(self._content, repo, branch, blob_cache=self._blob_cache)
        with self._index_lock:
            self._index_cache[key] = (head, idx)
        return idx

    # --- the status join ------------------------------------------------------------------------

    def _status_map(self) -> dict[tuple[str, str], TaskState]:
        """``(repo, branch) → TaskState`` for tasks with an open PR — the S1 join key."""
        with self._read_lock:                       # the only DB touch; content fetches stay concurrent
            raw = self._events.read()
        m: dict[tuple[str, str], TaskState] = {}
        for t in project(raw).values():
            if t.pr and t.pr.get("repo") and t.branch:
                m[(t.pr["repo"], t.branch)] = t
        return m

    def _branches(self, repo: str, status_map: dict[tuple[str, str], TaskState]) -> list[str]:
        branches = {self._default_branch} | {b for (r, b) in status_map if r == repo}
        return sorted(branches)

    def _summary(self, product_id: str, spec: IndexedSpec, task: Optional[TaskState]) -> dict:
        return {"feature": spec.feature, "task": spec.task, "kind": spec.kind, "title": spec.title,
                "ref": _ref_json(spec.ref), "availability": "indexed",
                "status": _status(task, spec.kind) if task else None,
                "href": _href(product_id, spec)}


def _status(task: TaskState, kind: str) -> dict:
    gate_name = "functional" if kind == KIND_FUNCTIONAL else "technical_design"
    gate_type = "functional" if kind == KIND_FUNCTIONAL else "technical"
    decisions = [g for g in task.gates if g.gate == gate_name]
    return {"task_id": task.task_id, "stage": task.stage,
            "gate": {"type": gate_type, "decision": decisions[-1].decision if decisions else "pending"},
            "branch": task.branch, "merged": task.merged}


def _gate_json(g: GateDecision) -> dict:
    return {"gate": g.gate, "decision": g.decision, "resolved_by": g.resolved_by,
            "resolved_at": g.resolved_at, "seq": g.seq}


def _ref_json(ref: SpecRef) -> dict:
    return {"repo": ref.repo, "branch": ref.branch, "path": ref.path, "commit": ref.commit}


def _href(product_id: str, spec: IndexedSpec) -> str:
    return (f"/api/products/{quote(product_id)}/specs/{quote(spec.feature)}/{quote(spec.kind)}"
            f"?branch={quote(spec.ref.branch, safe='')}")
