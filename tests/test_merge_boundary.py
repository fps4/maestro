"""The merge boundary is the load-bearing safety check (ADR-0016, US-0001): maestro refuses to merge
without a valid, role-authorized, unconsumed merge-approval event. These are the negative tests an
unapproved / forged / replayed merge must fail — plus the positive single-use path.
"""
import pytest

from adapters.github.adapter import (
    MERGE_EXECUTED,
    MERGE_REFUSED,
    MergeRefused,
    append_merge_approval,
)

REPO = "acme/widget"
RUN = "task-1"
PR = 100


def _open_pr(github):
    github.open_branch(RUN, REPO, "maestro/feature", from_ref="main")
    return github.open_pr(RUN, REPO, "maestro/feature", "main", "title", "body")


def _refused(events, reason):
    refusals = [e for e in events.read(RUN) if e["type"] == MERGE_REFUSED]
    assert refusals, "a merge.refused event must be logged"
    assert refusals[-1]["payload"]["reason"] == reason


def test_merge_without_approval_is_refused_and_logged(github, events):
    pr = _open_pr(github)
    with pytest.raises(MergeRefused) as ei:
        github.merge(RUN, REPO, pr["number"])
    assert ei.value.reason == "no-approval"
    _refused(events, "no-approval")
    assert not github._client.merges  # the underlying merge was never called


def test_valid_approval_merges_once(github, events):
    pr = _open_pr(github)
    append_merge_approval(events, RUN, REPO, pr["number"], by="@arch")
    result = github.merge(RUN, REPO, pr["number"])
    assert result["merged"] is True
    executed = [e for e in events.read(RUN) if e["type"] == MERGE_EXECUTED]
    assert len(executed) == 1
    assert github._client.merges == [(REPO, pr["number"], "squash")]


def test_replayed_approval_is_refused(github, events):
    pr = _open_pr(github)
    append_merge_approval(events, RUN, REPO, pr["number"], by="@arch")
    github.merge(RUN, REPO, pr["number"])            # consumes the approval
    with pytest.raises(MergeRefused) as ei:
        github.merge(RUN, REPO, pr["number"])        # replay
    assert ei.value.reason == "already-consumed"
    _refused(events, "already-consumed")
    assert len(github._client.merges) == 1           # not merged a second time


def test_approval_by_non_role_holder_is_refused(github, events):
    pr = _open_pr(github)
    append_merge_approval(events, RUN, REPO, pr["number"], by="@dev")  # @dev is not the architect
    with pytest.raises(MergeRefused) as ei:
        github.merge(RUN, REPO, pr["number"])
    assert ei.value.reason == "unauthorized-role"
    _refused(events, "unauthorized-role")


def test_approval_for_a_different_pr_does_not_authorize(github, events):
    pr = _open_pr(github)
    append_merge_approval(events, RUN, REPO, pr_number=999, by="@arch")  # wrong PR
    with pytest.raises(MergeRefused) as ei:
        github.merge(RUN, REPO, pr["number"])
    assert ei.value.reason == "no-approval"


def test_forged_approval_breaks_the_chain_and_is_refused(github, events, conn):
    pr = _open_pr(github)
    appr = append_merge_approval(events, RUN, REPO, pr["number"], by="@arch")
    # Forge: rewrite the recorded decider in the row to a non-role-holder, leaving the stored hash
    # stale. The hash chain (ADR-0009) detects the alteration, so the merge is refused before the
    # authorization check even runs — there is no GitHub-side backstop (ADR-0016).
    forged = ('{"by":"@mallory","decision":"approve","pr_number":%d,"repo":"%s",'
              '"role":"architect","task_id":"%s"}' % (pr["number"], REPO, RUN))
    conn.execute("UPDATE events SET payload = ? WHERE seq = ?", (forged, appr["seq"]))
    conn.commit()
    with pytest.raises(MergeRefused) as ei:
        github.merge(RUN, REPO, pr["number"])
    assert ei.value.reason == "chain-broken"
    _refused(events, "chain-broken")


def test_request_changes_is_not_an_approval(github, events):
    pr = _open_pr(github)
    # A gate.resolved request_changes — not a merge-approval event at all.
    events.append(run_id=RUN, actor="@arch", type="gate.resolved", target=f"{REPO}#{pr['number']}",
                  payload={"gate": "technical_merge", "decision": {"decision": "request_changes",
                                                                   "by": "@arch"}})
    with pytest.raises(MergeRefused) as ei:
        github.merge(RUN, REPO, pr["number"])
    assert ei.value.reason == "no-approval"


def test_no_direct_default_branch_push_path():
    """ADR-0016: the adapter exposes no way to push to a default branch — merge is the only path in,
    and it is guarded. Guard against a regression that adds one."""
    from adapters.github.adapter import GitHubAdapter
    pushy = [n for n in dir(GitHubAdapter)
             if any(k in n.lower() for k in ("push", "commit_to", "force"))]
    assert pushy == []
