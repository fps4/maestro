"""The workspace write API — the orchestrator's write surface (S2/S3 + M1 dispatch).

This is the **framework-agnostic core** of the contract in
``docs/architecture/contracts/workspace-write-api.md`` (an additive extension of the read API
contract, ratified 2026-05-29). Each request becomes **exactly one attributed event** in the event
log (ADR-0008/0009); the workspace holds no authoritative state (ADR-0015). Three endpoint families
ship under M1:

* ``POST /api/products/{p}/tasks`` — dispatch a new delivery task (the workspace "new task" form,
  US-0010 Q2 resolution).
* ``POST /api/products/{p}/tasks/{t}/comments`` — anchored comment on a task (S2 — Discuss).
* ``POST /api/products/{p}/tasks/{t}/gates/{gate_id}/decisions`` — decide a gate (S3 — Decide):
  approve / request_changes / reject. The consequential write; the join point with LangGraph's
  ``interrupt()`` (ADR-0014). Required ``Idempotency-Key`` + ``If-Match`` on the gate's seq.

Shared concerns with the read API (identity header, register-based authorization, isolation-is-404,
error envelope) are imported from :mod:`orchestrator.readapi` so there is one boundary, not two. The
write surface adds **idempotency** (:mod:`orchestrator.idempotency`) and **optimistic concurrency**
on gate decisions via the ``open_gates[type].seq`` projection counter.

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
MAX_RATIONALE_CHARS = 16000

# Anchor locator shapes per artefact.kind (workspace-write-api.md §anchor-locators, resolved 2026-05-28).
_KIND_TO_LOCATOR_KEYS = {
    "functional_spec":   {"criterion_id", "heading"},
    "technical_design":  {"heading"},                   # M1: heading slugs only; block_id deferred
    "pull_request_diff": {"path", "side", "line"},      # M2+; structure pinned for forward compat
}

# Which gate types may be decided in M1 (data-model.md GateType). The merge gate is M2; it is named
# here for forward-compatibility — workspace-write-api.md routes ``gate.type = "merge"`` through this
# same endpoint when M2 opens it. The reviewer-role resolution differs per type (see RoutingResolver).
_DECIDABLE_GATE_TYPES = {"functional", "technical_design", "technical_merge"}

# Allowed decisions (workspace-write-api.md §POST-decisions).
_DECISIONS = {"approve", "request_changes", "reject"}

# Which artefact kind a feedback bundle keeps when collecting items for a given gate
# (ADR-0020 §composition-rule). ``technical_merge`` is named here so M2's merge-gate slice doesn't
# need to touch this rule.
_GATE_TO_ANCHOR_KIND = {
    "functional": "functional_spec",
    "technical_design": "technical_design",
    "technical_merge": "pull_request_diff",
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


class GateStateMoved(APIError):
    """The gate's ``seq`` has advanced since the client last read it (another role-holder decided,
    or the agent re-drafted past the client's view). The client should re-read and retry
    (workspace-write-api.md §optimistic-concurrency)."""
    code = "gate_state_moved"
    status = 409


class GateAlreadyResolved(APIError):
    """The gate is no longer pending — a terminal decision (approve / reject) has already been
    recorded for this opening (workspace-write-api.md §POST-decisions)."""
    code = "gate_already_resolved"
    status = 409


# --- helpers ----------------------------------------------------------------------------------------

def _default_run_id() -> str:
    """Mint an opaque task id (``run-<8 hex>``). 32 bits is enough collision-resistance at dogfood
    scale; full uuid lands when concurrent dispatch volume warrants."""
    return f"run-{uuid.uuid4().hex[:8]}"


def _default_comment_id() -> str:
    """Mint an opaque comment id (``cmt-<8 hex>``). Same logic as :func:`_default_run_id`."""
    return f"cmt-{uuid.uuid4().hex[:8]}"


def _default_bundle_id() -> str:
    """Mint an opaque feedback-bundle id (``fb-<8 hex>``). ADR-0020 leaves the shape opaque; this
    matches the run/comment id pattern so audit + UI handle every id the same way."""
    return f"fb-{uuid.uuid4().hex[:8]}"


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
    ENDPOINT_DECISION = "POST /api/products/{p}/tasks/{t}/gates/{g}/decisions"

    def __init__(self, register: Register, events: EventLog, routing: RoutingResolver,
                 idempotency: IdempotencyStore, *,
                 id_factory=None, comment_id_factory=None, bundle_id_factory=None,
                 dispatcher=None, resumer=None, refinement_cap=None):
        """``id_factory`` mints task ids; ``comment_id_factory`` mints comment ids;
        ``bundle_id_factory`` mints feedback-bundle ids. All three are injectable for deterministic
        tests; production uses :func:`_default_run_id` / :func:`_default_comment_id` /
        :func:`_default_bundle_id`.

        ``dispatcher`` and ``resumer`` are the **engine-stream hooks** (ADR-0014). After a
        ``task.dispatched`` event lands, ``dispatcher(task_id)`` kicks off the LangGraph run for
        that task; after a ``gate.decided`` event lands, ``resumer(task_id, gate_type, decision)``
        resumes the suspended graph. Both are **optional** so this write API stays usable in
        contract tests with no engine attached (the existing 153-test suite); production wires
        them at boot to async wrappers around :class:`orchestrator.runtime.LangGraphRuntime` so
        the HTTP request returns immediately while the graph runs in the background.
        """
        self._register = register
        self._events = events
        self._routing = routing
        self._idempotency = idempotency
        self._id_factory = id_factory or _default_run_id
        self._comment_id_factory = comment_id_factory or _default_comment_id
        self._bundle_id_factory = bundle_id_factory or _default_bundle_id
        self._dispatcher = dispatcher
        self._resumer = resumer
        # US-0024 H2: an explicit override for the refinement-loop cap (tests inject a small value);
        # ``None`` reads the configured cap from the routing matrix (gate.max_refinement_iterations).
        self._refinement_cap_override = refinement_cap
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

        # Kick the engine stream — strictly after the event lands and outside the write lock so a
        # synchronous (test) dispatcher cannot deadlock with us. Replays don't reach here (the
        # ``return cached["response"]`` short-circuit above means the original call already ran
        # this once). A failure here is logged but does not invalidate the response — the
        # ``task.dispatched`` event is the authority; a missed kick is recoverable from the log.
        self._kick(self._dispatcher, task_id)
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

    def decide_gate(self, identity: str, product_id: str, task_id: str, gate_id: str, *,
                    decision: str, rationale: Optional[str] = None,
                    if_match: Optional[int] = None,
                    idempotency_key: Optional[str] = None) -> dict:
        """``POST /api/products/{p}/tasks/{t}/gates/{gate_id}/decisions`` — decide a gate (S3).

        The consequential write: approve / request_changes / reject. Authorization is **role-based**
        — the caller must hold the role :class:`RoutingResolver` resolves for the gate's
        ``(product_type, gate_type)`` (US-0012). The decision is recorded as a single ``gate.decided``
        event, attributed to the deciding participant (ADR-0009). On ``request_changes`` the open
        anchored comments are also bundled into a ``feedback_bundle.created`` event (ADR-0020); the
        agent re-drafts from that bundle's snapshot.

        ``if_match`` is the ``open_gates[type].seq`` the client read; a stale seq → 409
        ``gate_state_moved`` (workspace-write-api.md §optimistic-concurrency). ``idempotency_key`` is
        **required** on decisions — the most consequential write — per the same contract.

        M1 simplification: ``gate_id`` is matched against the gate's **type slug**
        (``"functional"`` / ``"technical_design"`` / ``"technical_merge"``) or the deterministic
        opaque id the projection mints (``gate-<opener_seq:04x>``). Either form resolves to the same
        open gate; the response surfaces the opaque form so a workspace UI sees stable ids.
        """
        product = self._authorize_product(identity, product_id)
        participant = product.participant_for(identity)
        self._load_task(task_id, expected_product_id=product.id)        # 404 if not on this product

        if decision not in _DECISIONS:
            raise ValidationFailed(
                f"decision must be one of {sorted(_DECISIONS)!r}; got {decision!r}"
            )
        rationale = (rationale or "").strip() or None
        if decision in ("request_changes", "reject") and not rationale:
            raise ValidationFailed(f"rationale is required for decision {decision!r}")
        if rationale is not None and len(rationale) > MAX_RATIONALE_CHARS:
            raise ValidationFailed(
                f"rationale exceeds {MAX_RATIONALE_CHARS} chars ({len(rationale)} given)"
            )
        if not idempotency_key:
            # The contract makes idempotency REQUIRED for decisions — without it a stuttering
            # network can double-resolve a gate, and a double approval can ship something the
            # architect didn't actually approve twice. We refuse rather than guess.
            raise ValidationFailed("Idempotency-Key is required for gate decisions")
        if if_match is None:
            raise ValidationFailed("If-Match (gate.seq) is required for gate decisions")

        # Hash the **request** (not the resolved gate) so a replay matches exactly — the gate may
        # have closed by the time we replay, which is fine: idempotency takes precedence over the
        # gate-state preconditions (workspace-write-api.md §idempotency: "returns the original
        # response on a retry").
        request_body = {
            "decision": decision,
            "rationale": rationale,
            "if_match": if_match,
            "gate_id_url": gate_id,            # the URL form the client sent, not the resolved opaque id
        }
        request_hash = _hash_request(request_body)

        with self._write_lock:
            # 1. Idempotency comes first. A successful prior call cached its response; we return it
            #    verbatim regardless of whether the gate has since moved/closed.
            cached = self._idempotency.lookup(
                identity, self.ENDPOINT_DECISION, idempotency_key,
            )
            if cached is not None:
                if cached["request_hash"] != request_hash:
                    raise IdempotencyMismatch(
                        f"key {idempotency_key!r} previously bound to a different request body"
                    )
                return cached["response"]

            # 2. Re-read the task under the lock; resolve the gate against fresh state. This is the
            #    write path's source of truth — concurrent deciders see this same snapshot.
            fresh = self._load_task(task_id, expected_product_id=product.id)
            gate = self._resolve_open_gate(fresh, gate_id)
            gate_type = gate["type"]
            opaque_id = gate["gate_id"]
            if if_match != gate["seq"]:
                raise GateStateMoved(
                    f"gate {opaque_id!r} is at seq {gate['seq']}, not {if_match}; re-read and retry"
                )

            # 3. Role check: the caller must hold the reviewer role for (product_type, gate_type).
            required_role = self._routing.role_for(product.product_type, gate_type)
            if participant.role != required_role:
                raise ForbiddenRole(
                    f"deciding the {gate_type} gate on a {product.product_type} product requires "
                    f"role {required_role!r}; you are {participant.role!r}"
                )

            attributed_to = {
                "email": identity, "role": participant.role, "product_id": product.id,
            }

            # US-0024 H2: bound the refinement loop. Once this gate has already seen ``cap``
            # request_changes cycles, a further request_changes **blocks** the task rather than
            # opening yet another re-draft — an unbounded request_changes → re-draft → … loop can
            # burn material cost on a pathological task. The architect re-files or resumes (US-0020).
            cap = self._refinement_cap()
            blocked_by_cap = False
            if decision == "request_changes":
                prior_rc = sum(1 for g in fresh.gates
                               if g.gate == gate_type and g.decision == "request_changes")
                blocked_by_cap = prior_rc >= cap

            bundle_id = None
            bundle_items = None
            if decision == "request_changes" and not blocked_by_cap:
                bundle_id = self._bundle_id_factory()
                bundle_items = self._collect_feedback_items(fresh, gate_type)

            event = self._events.append(
                run_id=task_id,
                actor=participant.handle,
                type="gate.decided",
                target=f"gate:{opaque_id}",
                payload={
                    "gate_id": opaque_id,
                    "task_id": task_id,
                    "product_id": product.id,
                    "type": gate_type,
                    "decision": decision,
                    "rationale": rationale,
                    "attributed_to": attributed_to,
                    "feedback_bundle_id": bundle_id,
                    "if_match_seq": if_match,
                    "refinement_capped": blocked_by_cap,
                },
            )

            if decision == "request_changes" and not blocked_by_cap:
                # The bundle is a server-side projection (ADR-0020 §eventing): one event after the
                # decision carries the anchored-items snapshot the agent will read. We do not append
                # an event when the bundle is empty — the rationale alone is the hand-off, and an
                # empty ``items[]`` carries no information for the audit replay.
                self._events.append(
                    run_id=task_id,
                    actor=participant.handle,
                    type="feedback_bundle.created",
                    target=f"feedback_bundle:{bundle_id}",
                    payload={
                        "bundle_id": bundle_id,
                        "task_id": task_id,
                        "gate": {"id": opaque_id, "type": gate_type},
                        "rationale": rationale,
                        "items": bundle_items,
                        "attributed_to": attributed_to,
                    },
                )
            elif blocked_by_cap:
                # The decision is still recorded (the architect *did* request changes — an audited
                # fact); the system's response is to block, not to loop. The projection flips the
                # task to ``blocked`` on this event (projection._apply: task.blocked).
                self._events.append(
                    run_id=task_id,
                    actor=participant.handle,
                    type="task.blocked",
                    target=f"task:{task_id}",
                    payload={
                        "task_id": task_id,
                        "product_id": product.id,
                        "reason": "refinement_cap_exceeded",
                        "gate": gate_type,
                        "cap": cap,
                        "attributed_to": attributed_to,
                    },
                )

            response = {
                "task_id": task_id,
                "gate_id": opaque_id,
                "gate": {"type": gate_type, "decision": decision, "seq": event["seq"]},
                "attributed_to": {"email": identity, "role": participant.role},
                "decided_at": _iso(event["ts"]),
                "event_seq": event["seq"],
                "feedback_bundle_id": bundle_id,
            }
            if blocked_by_cap:
                response["status"] = "blocked"
                response["blocked_reason"] = "refinement_cap_exceeded"
            if idempotency_key:
                self._idempotency.remember(
                    identity, self.ENDPOINT_DECISION, idempotency_key,
                    request_hash=request_hash,
                    response=response,
                    event_seq=event["seq"],
                )

        # Resume the LangGraph stage outside the write lock. Replays don't reach here (cache
        # short-circuit above). On ``reject`` the graph still resumes — the routing rule sends
        # the run to END so the checkpointer marks the thread done; the projection independently
        # sets ``status=cancelled``. Both happen exactly once per fresh decision. When the
        # refinement cap blocked the task we do **not** resume — looping the graph back to the
        # producer is exactly what the cap exists to prevent.
        if not blocked_by_cap:
            self._kick(self._resumer, task_id, gate_type, decision)
        return response

    # --- refinement-loop bound (US-0024 H2) -----------------------------------------------------

    def _refinement_cap(self) -> int:
        """The max request_changes cycles a gate may take before blocking. An explicit constructor
        override wins (tests); otherwise the configured cap from the routing matrix."""
        if self._refinement_cap_override is not None:
            return self._refinement_cap_override
        return self._routing.refinement_cap()

    # --- engine-stream kick (LangGraph runtime hook; ADR-0014) ---------------------------------

    @staticmethod
    def _kick(hook, *args) -> None:
        """Fire one engine-stream hook (``dispatcher`` or ``resumer``) defensively. ``None`` is the
        contract-tests path (no engine attached); a hook that raises does **not** roll back the
        write — the event is already authoritative (ADR-0008). The error is re-raised so the
        boot path's executor logs it; production wires hooks through a thread-pool wrapper that
        swallows + logs, so the HTTP request still returns its success."""
        if hook is None:
            return
        hook(*args)

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

    # --- gate resolution + feedback-bundle composition -------------------------------------------

    def _resolve_open_gate(self, task, gate_id: str) -> dict:
        """Find the pending gate on ``task`` whose URL slug matches ``gate_id``.

        Two URL shapes resolve to the same gate: the gate-type slug (``"functional"`` etc.) or the
        deterministic opaque id the projection minted (``gate-<opener_seq:04x>``). If no gate of any
        recognised type is pending under ``gate_id``, distinguish:

        * **never opened** on this task → :class:`NotFound` (the gate-id has no projection presence).
        * **opened then resolved already** → :class:`GateAlreadyResolved` (terminal decision recorded).

        This split lets the workspace surface the right message: "no such gate" vs. "another
        role-holder already decided" (workspace-write-api.md §POST-decisions).
        """
        # Direct type match (M1 wire shape — the workspace sends "functional" / "technical_design").
        if gate_id in _DECIDABLE_GATE_TYPES:
            pending = task.open_gates.get(gate_id)
            if pending is not None:
                return pending
            # The gate type is decidable, but no open instance. Was one ever resolved?
            for g in task.gates:
                if g.gate == gate_id:
                    raise GateAlreadyResolved(
                        f"gate of type {gate_id!r} on task {task.task_id!r} is no longer pending"
                    )
            raise NotFound(f"no pending {gate_id!r} gate on task {task.task_id!r}")

        # Opaque id match (forward shape — the projection mints these so workspace UIs can hold a
        # stable URL across a refinement loop's lifetime).
        for pending in task.open_gates.values():
            if pending["gate_id"] == gate_id:
                return pending
        for g in task.gates:
            # We don't record gate_id on resolved decisions today, but the type carries the same
            # M1 identity — if the suffix matches the gate type, the decision belongs to this gate.
            if gate_id.endswith(f"-{g.gate}") or g.gate == gate_id:
                raise GateAlreadyResolved(
                    f"gate {gate_id!r} on task {task.task_id!r} is no longer pending"
                )
        raise NotFound(f"no gate {gate_id!r} on task {task.task_id!r}")

    def _collect_feedback_items(self, task, gate_type: str) -> list[dict]:
        """Snapshot the anchored comments that belong in the ADR-0020 feedback bundle for this
        gate's open instance.

        Composition rule (ADR-0020 §composition-rule, M1 slice):

        1. Comments on this ``task`` only.
        2. Anchored to an artefact matching the gated kind for this gate type:

           * ``functional`` gate → ``functional_spec`` anchors.
           * ``technical_design`` gate → ``technical_design`` anchors.
           * ``technical_merge`` gate → ``pull_request_diff`` anchors (M2; included here so the
             rule stays one place when M2 opens).

        3. Posted after the gate's opener event (matched by ``seq`` ordering on the projection).
        4. Unanchored comments are excluded from ``items[]`` — the contract folds them into the
           top-level ``rationale`` at the agent boundary, not at this snapshot layer.

        We deliberately do **not** verify the anchor's `commit` against the gate's commit here —
        agents don't yet stamp the gated commit on opener events (M1 known limitation). The check
        lands when the spec/design agents publish their refs (US-0010/US-0013).
        """
        wanted_kind = _GATE_TO_ANCHOR_KIND.get(gate_type)
        opener_seq = task.open_gates[gate_type]["seq"]
        items: list[dict] = []
        for c in task.comments:
            if c.seq <= opener_seq:
                continue                                    # before this opening — not in scope
            anchor = c.anchor or {}
            artefact = anchor.get("artefact") if isinstance(anchor, dict) else None
            if not isinstance(artefact, dict):
                continue                                    # unanchored — rolled into rationale
            if wanted_kind is not None and artefact.get("kind") != wanted_kind:
                continue
            items.append({
                "anchor": anchor,
                "comments": [{
                    "id": c.comment_id, "body": c.body, "author": c.author,
                    "created_at": _iso(c.created_at), "in_reply_to": c.in_reply_to,
                }],
                "suggested_change": None,                   # M1: not surfaced by the comment write
            })
        return items


def _iso(ts: float) -> str:
    """Render an event timestamp as ISO 8601 UTC (matches the contract's example response)."""
    import datetime as _dt
    return _dt.datetime.fromtimestamp(ts, tz=_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
