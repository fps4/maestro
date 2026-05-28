"""The workspace write API — the orchestrator's write surface (S2/S3 + M1 dispatch).

This is the **framework-agnostic core** of the contract in
``docs/architecture/contracts/workspace-write-api.md`` (an additive extension of the read API
contract, decided 2026-05-28). Each request becomes **exactly one attributed event** in the event
log (ADR-0008/0009); the workspace holds no authoritative state (ADR-0015). Three endpoint families
ship under M1; this file lands the **dispatch** endpoint first — the workspace "new task" form
(US-0010 Q2 resolution). Comment + gate-decision endpoints follow in subsequent slices.

Shared concerns with the read API (identity header, register-based authorization, isolation-is-404,
error envelope) are imported from :mod:`orchestrator.readapi` so there is one boundary, not two. The
write surface adds **idempotency** (:mod:`orchestrator.idempotency`) and — for later endpoints —
optimistic concurrency on gate decisions via the ``Gate.seq`` projection counter.

It holds no GitHub token and no LLM egress; the HTTP binding lives in :mod:`orchestrator.httpserver`.
"""
import hashlib
import json
import threading
import uuid
from typing import Optional

from orchestrator.eventlog import EventLog
from orchestrator.idempotency import IdempotencyStore
from orchestrator.projection import project_task
from orchestrator.readapi import APIError, NotFound, Unauthenticated
from orchestrator.register import Register
from orchestrator.routing import RoutingResolver

MAX_INTENT_CHARS = 8000
MAX_COMMENT_CHARS = 16000

# Anchor locator shapes per artefact.kind (workspace-write-api.md §anchor-locators, resolved 2026-05-28).
_KIND_TO_LOCATOR_KEYS = {
    "functional_spec":   {"criterion_id", "heading"},
    "technical_design":  {"heading"},                   # M1: heading slugs only; block_id deferred
    "pull_request_diff": {"path", "side", "line"},      # M2+; structure pinned for forward compat
}


# --- error classes ---------------------------------------------------------------------------------

class ForbiddenRole(APIError):
    """The caller participates in the product but lacks the role this write requires.

    The **one** place we surface 403 rather than 404 (workspace-write-api.md §endpoints): when the
    resource is visible to the caller but the authority for *this* write is not theirs.
    """
    code = "forbidden_role"
    status = 403


class ValidationFailed(APIError):
    """The request body is malformed for this endpoint (empty intent, oversize, unknown repo, …)."""
    code = "validation_failed"
    status = 422


class IdempotencyMismatch(APIError):
    """The ``Idempotency-Key`` was previously bound to a different request body — clients must mint
    a fresh key for a substantively different request (workspace-write-api.md §idempotency)."""
    code = "idempotency_mismatch"
    status = 409


class AnchorUnresolved(APIError):
    """The comment's ``anchor`` references an artefact ref that this task doesn't know about, or its
    locator shape is wrong for the artefact kind (workspace-write-api.md §POST-comments)."""
    code = "anchor_unresolved"
    status = 422


# --- helpers ----------------------------------------------------------------------------------------

def _default_run_id() -> str:
    """Mint an opaque task id (``run-<8 hex>``). 32 bits is enough collision-resistance at dogfood
    scale; full uuid lands when concurrent dispatch volume warrants."""
    return f"run-{uuid.uuid4().hex[:8]}"


def _default_comment_id() -> str:
    """Mint an opaque comment id (``cmt-<8 hex>``). Same logic as :func:`_default_run_id`."""
    return f"cmt-{uuid.uuid4().hex[:8]}"


def _canonical(body: dict) -> str:
    """Deterministic serialization for idempotency hashing — matches the eventlog canonical form."""
    return json.dumps(body, sort_keys=True, separators=(",", ":"), default=str, ensure_ascii=False)


def _hash_request(body: dict) -> str:
    return hashlib.sha256(_canonical(body).encode("utf-8")).hexdigest()


# --- the write API ---------------------------------------------------------------------------------

class WriteAPI:
    """Framework-agnostic core of the write contract. Tested with no sockets, no network, no LLM."""

    ENDPOINT_DISPATCH = "POST /api/products/{p}/tasks"
    ENDPOINT_COMMENT = "POST /api/products/{p}/tasks/{t}/comments"

    def __init__(self, register: Register, events: EventLog, routing: RoutingResolver,
                 idempotency: IdempotencyStore, *,
                 id_factory=None, comment_id_factory=None):
        """``id_factory`` mints task ids; ``comment_id_factory`` mints comment ids. Both are
        injectable for deterministic tests; production uses :func:`_default_run_id` /
        :func:`_default_comment_id`."""
        self._register = register
        self._events = events
        self._routing = routing
        self._idempotency = idempotency
        self._id_factory = id_factory or _default_run_id
        self._comment_id_factory = comment_id_factory or _default_comment_id
        # One writer lock across request threads — the read API has its own read lock, and SQLite's
        # single-writer model gives us serialization for free; this just keeps the idempotency
        # check-then-insert sequence atomic.
        self._write_lock = threading.Lock()

    # --- endpoints --------------------------------------------------------------------------------

    def dispatch_task(self, identity: str, product_id: str, intent: str, *,
                      repo: Optional[str] = None,
                      idempotency_key: Optional[str] = None) -> dict:
        """``POST /api/products/{product_id}/tasks`` — create a new delivery task (US-0010 Q2).

        Architect-only in M1 (the workspace "new task" form, resolved 2026-05-28). Emits
        ``task.dispatched``; the agent stream picks up from there. Returns the new task's id, its
        initial stage, the targeted ref skeleton, and the producing ``event_seq``.
        """
        product = self._authorize_product(identity, product_id)
        participant = product.participant_for(identity)
        if participant.role != "architect":
            raise ForbiddenRole(
                f"only architects may dispatch a delivery task in M1; you are {participant.role!r}"
            )

        intent = (intent or "").strip()
        if not intent:
            raise ValidationFailed("intent is required")
        if len(intent) > MAX_INTENT_CHARS:
            raise ValidationFailed(
                f"intent exceeds {MAX_INTENT_CHARS} chars ({len(intent)} given)"
            )

        if repo is None:
            if not product.repos:
                raise ValidationFailed(f"product {product_id!r} has no repos to target")
            repo = product.repos[0]
        elif repo not in product.repos:
            raise ValidationFailed(f"repo {repo!r} is not owned by product {product_id!r}")

        request_body = {"intent": intent, "repo": repo}
        request_hash = _hash_request(request_body)

        with self._write_lock:
            # Idempotency replay: a retry with the same key returns the original response unchanged.
            if idempotency_key:
                cached = self._idempotency.lookup(
                    identity, self.ENDPOINT_DISPATCH, idempotency_key,
                )
                if cached is not None:
                    if cached["request_hash"] != request_hash:
                        raise IdempotencyMismatch(
                            f"key {idempotency_key!r} previously bound to a different request body"
                        )
                    return cached["response"]

            task_id = self._id_factory()
            event = self._events.append(
                run_id=task_id,
                actor=participant.handle,
                type="task.dispatched",
                target=f"task:{task_id}",
                payload={
                    "task_id": task_id, "product_id": product.id, "repo": repo,
                    "intent": intent,
                    "attributed_to": {
                        "email": identity, "role": participant.role, "product_id": product.id,
                    },
                },
            )
            response = {
                "task_id": task_id, "product_id": product.id, "stage": "intake",
                "ref": {"repo": repo, "branch": None, "commit": None},
                "event_seq": event["seq"],
                "href": f"/api/products/{product.id}/tasks/{task_id}",
            }
            if idempotency_key:
                self._idempotency.remember(
                    identity, self.ENDPOINT_DISPATCH, idempotency_key,
                    request_hash=request_hash,
                    response=response,
                    event_seq=event["seq"],
                )
            return response

    def post_comment(self, identity: str, product_id: str, task_id: str, body: str, *,
                     anchor: Optional[dict] = None,
                     in_reply_to: Optional[str] = None,
                     idempotency_key: Optional[str] = None) -> dict:
        """``POST /api/products/{product_id}/tasks/{task_id}/comments`` — append an anchored comment.

        Authorization: any participant in the product may comment (no role filter — comments are
        not gate decisions). Append-only: every event is immutable; supersession is by a new
        comment, not an edit. Anchored where possible (workspace-ux-design.md P4); unanchored is a
        valid fallback.
        """
        product = self._authorize_product(identity, product_id)
        participant = product.participant_for(identity)

        body = (body or "").strip()
        if not body:
            raise ValidationFailed("comment body is required")
        if len(body) > MAX_COMMENT_CHARS:
            raise ValidationFailed(
                f"comment body exceeds {MAX_COMMENT_CHARS} chars ({len(body)} given)"
            )

        task = self._load_task(task_id, expected_product_id=product.id)

        if anchor is not None:
            self._validate_anchor(anchor, product=product, task=task)

        if in_reply_to is not None:
            self._validate_in_reply_to(in_reply_to, task_id=task_id)

        request_body = {
            "body": body,
            "anchor": anchor,
            "in_reply_to": in_reply_to,
        }
        request_hash = _hash_request(request_body)

        with self._write_lock:
            if idempotency_key:
                cached = self._idempotency.lookup(
                    identity, self.ENDPOINT_COMMENT, idempotency_key,
                )
                if cached is not None:
                    if cached["request_hash"] != request_hash:
                        raise IdempotencyMismatch(
                            f"key {idempotency_key!r} previously bound to a different request body"
                        )
                    return cached["response"]

            comment_id = self._comment_id_factory()
            event = self._events.append(
                run_id=task_id,
                actor=participant.handle,
                type="comment.posted",
                target=f"comment:{comment_id}",
                payload={
                    "comment_id": comment_id, "task_id": task_id, "product_id": product.id,
                    "body": body, "anchor": anchor, "in_reply_to": in_reply_to,
                    "attributed_to": {
                        "email": identity, "role": participant.role, "product_id": product.id,
                    },
                },
            )
            response = {
                "comment_id": comment_id,
                "task_id": task_id,
                "attributed_to": {"email": identity, "role": participant.role},
                "created_at": _iso(event["ts"]),
                "event_seq": event["seq"],
            }
            if idempotency_key:
                self._idempotency.remember(
                    identity, self.ENDPOINT_COMMENT, idempotency_key,
                    request_hash=request_hash,
                    response=response,
                    event_seq=event["seq"],
                )
            return response

    # --- isolation + identity ---------------------------------------------------------------------

    def _authorize_product(self, identity: str, product_id: str):
        """Same 404-not-403 isolation rule as the read API (ADR-0010/0011). Unknown product to this
        caller → :class:`NotFound`; only when the resource exists *and* is visible to the caller but
        the role for *this* write isn't theirs do we surface 403 (via :class:`ForbiddenRole`)."""
        if not identity:
            raise Unauthenticated("no caller identity")
        product = self._register.product(product_id)
        if product is None or product.participant_for(identity) is None:
            raise NotFound(f"product {product_id!r} not found")
        return product

    # --- task lookup + comment-payload validation -------------------------------------------------

    def _load_task(self, task_id: str, *, expected_product_id: str):
        """Project a task by id, verifying it belongs to ``expected_product_id``. Unknown task OR
        task on a different product → 404 (per-product isolation: a guessed URL must not surface a
        task that lives elsewhere)."""
        events = self._events.read(task_id)
        if not events:
            raise NotFound(f"task {task_id!r} not found")
        # The first event for a task — task.dispatched (M1) or task.created (legacy) — carries
        # product_id in its payload. Without it we cannot bind a task to a product safely.
        first = events[0]
        payload_product = first.get("payload", {}).get("product_id")
        if payload_product != expected_product_id:
            # Either the URL's {p} is wrong, or the task isn't a maestro-managed delivery task.
            raise NotFound(f"task {task_id!r} not found")
        return project_task(events, task_id)

    def _validate_anchor(self, anchor: dict, *, product, task) -> None:
        """Validate the shape — and, where the engine can, the existence — of a comment anchor.

        Shape rules (workspace-write-api.md §anchor-locators):
          * ``anchor.artefact.kind`` must be a known kind.
          * ``anchor.artefact.ref`` must be a ref dict (repo / branch / path / commit) on a repo
            owned by ``product``.
          * ``anchor.locator`` keys must match the kind's allowed locator schema.

        M1 known-limitation (recorded in the write-api contract): existence of the artefact ref
        itself is not verified against repo content. A real check lands when the spec/design agents
        publish refs via the SpecIndex hooks; for now the comment-event's payload carries the
        client-claimed ref and downstream consumers can re-validate.
        """
        if not isinstance(anchor, dict):
            raise AnchorUnresolved("anchor must be an object with `artefact` and `locator`")
        artefact = anchor.get("artefact") or {}
        kind = artefact.get("kind")
        if kind not in _KIND_TO_LOCATOR_KEYS:
            raise AnchorUnresolved(f"unknown artefact kind {kind!r}")
        ref = artefact.get("ref") or {}
        if not isinstance(ref, dict) or not ref.get("repo"):
            raise AnchorUnresolved("anchor.artefact.ref must include a repo")
        if ref["repo"] not in product.repos:
            raise AnchorUnresolved(
                f"anchor.artefact.ref.repo {ref['repo']!r} is not owned by product {product.id!r}"
            )
        locator = anchor.get("locator") or {}
        if not isinstance(locator, dict) or not locator:
            raise AnchorUnresolved("anchor.locator is required")
        allowed = _KIND_TO_LOCATOR_KEYS[kind]
        unknown = set(locator.keys()) - allowed
        if unknown:
            raise AnchorUnresolved(
                f"locator key(s) {sorted(unknown)!r} not allowed for kind {kind!r}"
            )

    def _validate_in_reply_to(self, comment_id: str, *, task_id: str) -> None:
        """Confirm the parent comment exists on the same task (a thread reply can't jump tasks)."""
        for e in self._events.read(task_id):
            if e["type"] == "comment.posted" and e["payload"].get("comment_id") == comment_id:
                return
        raise ValidationFailed(f"in_reply_to {comment_id!r} is not a comment on task {task_id!r}")


def _iso(ts: float) -> str:
    """Render an event timestamp as ISO 8601 UTC (matches the contract's example response)."""
    import datetime as _dt
    return _dt.datetime.fromtimestamp(ts, tz=_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
