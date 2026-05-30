"""The GitHub adapter — branches, PRs, and the **event-gated merge** (ADR-0016).

ADR-0016 (supersedes ADR-0004) makes maestro execute the merge, with the recorded **merge-approval
event as the sole authority** — there is no GitHub-side branch-protection backstop. That inverts the
old "maestro cannot merge" guarantee into a maestro-internal one, so this adapter's check *is* the
safety boundary. It refuses to merge unless handed an approval event that:

  1. **exists** for this task,
  2. is **typed** ``merge-approval`` and records an **approve** decision,
  3. **matches** this task + PR + repo,
  4. was decided by a participant **holding the gate's role** for the product (via the register +
     routing resolver — ADR-0011/0003), and
  5. has **not already been consumed** (anti-replay).

Additionally it verifies the event log's **hash chain** (ADR-0009): a forged or back-dated approval
breaks the chain and is refused. Every refusal is appended to the log (US-0001).

There is deliberately **no method that pushes to a default branch**: ``merge`` is the only path into a
default branch, and it is guarded. Merging is a deterministic adapter action, never a crew agent — no
reasoning, so reviewer≠author does not apply (ADR-0016).
"""
from typing import Optional, Protocol, runtime_checkable

from orchestrator.eventlog import ChainBroken, EventLog
from orchestrator.register import Register
from orchestrator.routing import RoutingResolver

MERGE_APPROVAL = "merge-approval"
MERGE_EXECUTED = "merge.executed"
MERGE_REFUSED = "merge.refused"
# The merge gate is a technical gate (it reviews the PR diff) — reviewers.yaml routing.technical.
MERGE_GATE = "technical_merge"


class MergeRefused(Exception):
    """Raised when the merge boundary rejects a merge. ``reason`` is a stable, logged code."""

    def __init__(self, reason: str, detail: str = ""):
        self.reason = reason
        super().__init__(f"{reason}: {detail}" if detail else reason)


@runtime_checkable
class GitHubClient(Protocol):
    """The minimal GitHub surface the adapter needs; injectable so the guard is testable offline."""

    def create_branch(self, repo: str, branch: str, from_ref: str) -> dict: ...
    def open_pull_request(self, repo: str, head: str, base: str, title: str, body: str,
                          draft: bool = False) -> dict: ...
    def merge_pull_request(self, repo: str, number: int, method: str) -> dict: ...
    def put_file(self, repo: str, path: str, content: str, branch: str, message: str,
                 sha: Optional[str] = None) -> dict: ...
    def commit_files(self, repo: str, branch: str, files: list[dict], message: str) -> dict: ...


def append_merge_approval(events: EventLog, run_id: str, repo: str, pr_number: int,
                          by: str, role: str = "architect") -> dict:
    """Record a workspace merge approval as an event (what the orchestrator's GateManager does on an
    approve at the merge gate; ADR-0016). Exposed here so the adapter/tests share one shape."""
    return events.append(
        run_id=run_id, actor=by, type=MERGE_APPROVAL, target=f"{repo}#{pr_number}",
        payload={"task_id": run_id, "repo": repo, "pr_number": pr_number,
                 "decision": "approve", "by": by, "role": role},
    )


class GitHubAdapter:
    def __init__(self, events: EventLog, register: Register, routing: RoutingResolver,
                 client: GitHubClient, actor: str = "github-adapter"):
        self._events = events
        self._register = register
        self._routing = routing
        self._client = client
        self._actor = actor

    # --- write paths into a maestro/* branch (never the default branch directly) ---------------

    def open_branch(self, run_id: str, repo: str, branch: str, from_ref: str = "main") -> dict:
        if not branch.startswith("maestro/"):
            raise ValueError(f"agents create only maestro/* branches, got {branch!r} (standards/git.yaml)")
        result = self._client.create_branch(repo, branch, from_ref)
        self._events.append(run_id=run_id, actor=self._actor, type="branch.created",
                            target=f"{repo}:{branch}", payload={"repo": repo, "branch": branch,
                                                                "from_ref": from_ref})
        return result

    def open_pr(self, run_id: str, repo: str, head: str, base: str, title: str, body: str,
                draft: bool = False) -> dict:
        pr = self._client.open_pull_request(repo, head, base, title, body, draft=draft)
        self._events.append(run_id=run_id, actor=self._actor, type="pr.opened",
                            target=f"{repo}#{pr['number']}",
                            payload={"repo": repo, "branch": head, "pr_number": pr["number"],
                                     "pr_url": pr.get("url"), "draft": draft})
        return pr

    def commit_artefact(self, run_id: str, repo: str, branch: str, path: str, content: str,
                        message: str, sha: Optional[str] = None) -> dict:
        """Commit an agent-produced artefact (a spec or design markdown) to a ``maestro/*`` branch.

        This is the agent's write path: the agent reasons through the :class:`ModelClient`, hands
        the artefact text to this adapter, and the adapter does the I/O + emits the
        ``artefact.committed`` event (one event per commit, so the audit replays exactly which
        commits the crew produced — ADR-0008/0009).

        The same ``maestro/*``-only check :meth:`open_branch` enforces is applied here — the
        adapter is the **only** code path into a non-default GitHub write, so the policy lives in
        one place. The default-branch refusal is structural: there is no overload that targets a
        default branch, so a misuse fails fast at this guard and is logged.
        """
        if not branch.startswith("maestro/"):
            raise ValueError(
                f"agents commit only to maestro/* branches, got {branch!r} (standards/git.yaml)"
            )
        result = self._client.put_file(repo, path, content, branch, message, sha=sha)
        self._events.append(
            run_id=run_id, actor=self._actor, type="artefact.committed",
            target=f"{repo}:{branch}:{path}",
            payload={"repo": repo, "branch": branch, "path": path,
                     "commit_sha": result.get("commit_sha"),
                     "file_sha": result.get("file_sha"),
                     "message": message,
                     "updated": sha is not None},
        )
        return result

    def commit_change(self, run_id: str, repo: str, branch: str, files: list[dict], message: str,
                      *, task: Optional[int] = None,
                      requirements: Optional[list] = None) -> dict:
        """Commit the builder agent's implementation — **one atomic commit, many files** (US-0011).

        The spec/design agents land a single markdown artefact through :meth:`commit_artefact`; the
        builder lands code, and the M2 commit-shape resolution pins **one commit per task-list entry**
        (message ``task-{n}: <title>``) so the commit graph mirrors the design's task structure and
        ``git bisect`` isolates a later DoD failure to one task. The Contents API commits one file at
        a time, so a multi-file task would fan out into several commits; this path uses the Git Data
        API (``commit_files``) to keep a task's files in **one** commit.

        ``files`` is a list of ``{"path", "content"}``. The same ``maestro/*``-only guard the other
        write paths enforce applies here — the adapter is the only code path into a non-default GitHub
        write, so the default-branch refusal lives in one place (ADR-0016). One ``commit.created``
        event per commit, so the audit replays exactly which commits the builder produced
        (ADR-0008/0009).
        """
        if not branch.startswith("maestro/"):
            raise ValueError(
                f"agents commit only to maestro/* branches, got {branch!r} (standards/git.yaml)"
            )
        result = self._client.commit_files(repo, branch, files, message)
        self._events.append(
            run_id=run_id, actor=self._actor, type="commit.created",
            target=f"{repo}:{branch}",
            payload={"repo": repo, "branch": branch, "task": task,
                     "requirements": list(requirements) if requirements is not None else None,
                     "paths": [f["path"] for f in files],
                     "commit_sha": result.get("commit_sha"),
                     "message": message},
        )
        return result

    # --- the safety boundary --------------------------------------------------------------------

    def merge(self, run_id: str, repo: str, pr_number: int, method: str = "squash",
              approval_seq: Optional[int] = None) -> dict:
        """Execute the merge **only** against a valid, role-authorized, unconsumed approval event.

        Returns the client merge result on success; raises :class:`MergeRefused` (after logging a
        ``merge.refused`` event) otherwise.
        """
        try:
            approval = self._authorize(run_id, repo, pr_number, approval_seq)
        except MergeRefused as refusal:
            self._events.append(
                run_id=run_id, actor=self._actor, type=MERGE_REFUSED, target=f"{repo}#{pr_number}",
                payload={"repo": repo, "pr_number": pr_number, "reason": refusal.reason,
                         "detail": str(refusal), "approval_seq": approval_seq},
            )
            raise

        result = self._client.merge_pull_request(repo, pr_number, method)
        self._events.append(
            run_id=run_id, actor=self._actor, type=MERGE_EXECUTED, target=f"{repo}#{pr_number}",
            payload={"repo": repo, "pr_number": pr_number, "method": method,
                     "approval_seq": approval["seq"], "by": approval["payload"]["by"],
                     "merge_sha": result.get("sha")},
        )
        return result

    def _authorize(self, run_id: str, repo: str, pr_number: int,
                   approval_seq: Optional[int]) -> dict:
        # The chain's integrity is the boundary now (no GitHub backstop) — verify it first (ADR-0009/0016).
        try:
            self._events.verify_chain()
        except ChainBroken as exc:
            raise MergeRefused("chain-broken", str(exc))

        product = self._register.product_for_repo(repo)
        if product is None:
            raise MergeRefused("unknown-product", f"no product owns repo {repo!r}")

        run_events = self._events.read(run_id)
        consumed = {e["payload"].get("approval_seq")
                    for e in run_events if e["type"] == MERGE_EXECUTED}

        candidates = [
            e for e in run_events
            if e["type"] == MERGE_APPROVAL
            and e["payload"].get("repo") == repo
            and e["payload"].get("pr_number") == pr_number
            and e["payload"].get("task_id") == run_id
        ]
        if approval_seq is not None:
            candidates = [e for e in candidates if e["seq"] == approval_seq]
        if not candidates:
            raise MergeRefused("no-approval",
                               f"no merge-approval event for {repo}#{pr_number} on task {run_id}")

        # Prefer the most recent unconsumed, validly-authorized approval.
        eligible = self._routing.eligible_deciders(product, MERGE_GATE)
        last_error = MergeRefused("no-approval", "no usable approval")
        for e in sorted(candidates, key=lambda e: e["seq"], reverse=True):
            try:
                if e["payload"].get("decision") != "approve":
                    raise MergeRefused("not-approved", f"approval seq={e['seq']} is not an approve")
                if e["seq"] in consumed:
                    raise MergeRefused("already-consumed", f"approval seq={e['seq']} already merged")
                decider = e["payload"].get("by")
                if not any(p.matches(decider) for p in eligible):
                    raise MergeRefused(
                        "unauthorized-role",
                        f"{decider!r} does not hold the {self._routing.role_for(product.product_type, MERGE_GATE)!r} "
                        f"role for product {product.id!r}",
                    )
                return e
            except MergeRefused as err:
                last_error = err
        raise last_error
