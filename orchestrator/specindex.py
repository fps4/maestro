"""The spec index — map ``feature/task → {repo, branch, path, commit, kind}`` from frontmatter.

ADR-0018 makes **frontmatter the index, with no separate manifest**: each spec/design markdown declares
its maestro identity in a ``maestro:`` YAML block, and maestro builds the index by reading it. This
module owns the read-only mechanics — parse the frontmatter, validate the ``maestro:`` block, classify a
``docs/**`` file — plus a scan that bootstraps a branch's index for the S1 read slice (ADR-0018: "for
the S1 dogfood slice it can bootstrap by scanning docs/** on the indexed branches"). The webhook ``push``
reconciler (ADR-0017) keeps it fresh later; that path reuses :func:`classify`.

Content is read through :class:`RepoContentReader` (the github adapter implements it), so the index
holds **no GitHub token and no authoritative state** (ADR-0015) — it projects the repo, one way.
"""
import re
from dataclasses import dataclass
from typing import Optional, Protocol, runtime_checkable

import yaml

KIND_FUNCTIONAL = "functional_spec"
KIND_TECHNICAL = "technical_design"
KINDS = {KIND_FUNCTIONAL, KIND_TECHNICAL}

DOCS_PREFIX = "docs/"

_FEATURE_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
_TASK_RE = re.compile(r"^US-\d{3,4}$")


@runtime_checkable
class RepoContentReader(Protocol):
    """The minimal, read-only GitHub surface the index needs; injectable so it is testable offline."""

    def get_contents(self, repo: str, path: str, ref: str) -> dict: ...   # -> {content, sha, path}
    def list_tree(self, repo: str, ref: str, path_prefix: str = "") -> list[str]: ...


@dataclass(frozen=True)
class SpecRef:
    """Where a spec lives, as-committed — the index value (ADR-0018)."""
    repo: str
    branch: str
    path: str
    commit: str


@dataclass(frozen=True)
class IndexedSpec:
    feature: str
    kind: str                 # functional_spec | technical_design
    task: Optional[str]       # US-NNNN, when a DeliveryTask owns it
    title: str
    ref: SpecRef


@dataclass(frozen=True)
class UnindexedDoc:
    """A doc that carries a ``maestro:`` block we could not honour — surfaced, never guessed."""
    ref: SpecRef
    reason: str


@dataclass
class BranchIndex:
    branch: str
    specs: list[IndexedSpec]
    unindexed: list[UnindexedDoc]


def parse_frontmatter(text: str) -> tuple[Optional[dict], str]:
    """Split a ``---`` YAML frontmatter block off the body. Returns ``(meta_or_None, body)``.

    Malformed YAML or a non-mapping block yields ``(None, body)`` — never raises (a bad doc must not
    take down the index).
    """
    if not text.startswith("---"):
        return None, text
    lines = text.splitlines()
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        return None, text
    body = "\n".join(lines[end + 1:])
    try:
        meta = yaml.safe_load("\n".join(lines[1:end]))
    except yaml.YAMLError:
        return None, body
    return (meta if isinstance(meta, dict) else None), body


def classify(meta: Optional[dict], body: str) -> tuple[Optional[dict], Optional[str]]:
    """Classify a parsed doc against the ``maestro:`` contract (ADR-0018).

    Returns ``(fields, reason)``:
      * ``fields`` set  → indexed; a dict ``{feature, kind, task, title}``.
      * ``reason`` set  → the doc *claims* a ``maestro:`` identity but it is malformed → unindexed.
      * both ``None``   → not a spec/design (no ``maestro:`` block) → ignored, not flagged.

    Plain docs (guides, READMEs, ADRs) have no ``maestro:`` block and are silently skipped — only docs
    that opt in via the block participate, so the index is signal, not noise. A *known* spec ref that
    has lost its block is the reconciler's "missing" case (ADR-0017), not this scan's.
    """
    if not isinstance(meta, dict) or "maestro" not in meta:
        return None, None
    m = meta.get("maestro")
    if not isinstance(m, dict):
        return None, "malformed maestro: frontmatter (not a mapping)"
    feature, kind, task = m.get("feature"), m.get("kind"), m.get("task")
    if not isinstance(feature, str) or not _FEATURE_RE.match(feature):
        return None, "malformed maestro: frontmatter (feature)"
    if kind not in KINDS:
        return None, "malformed maestro: frontmatter (kind)"
    if task is not None and not (isinstance(task, str) and _TASK_RE.match(task)):
        return None, "malformed maestro: frontmatter (task)"
    return {"feature": feature, "kind": kind, "task": task,
            "title": _title(meta, body, feature)}, None


def _title(meta: dict, body: str, fallback: str) -> str:
    t = meta.get("title")
    if isinstance(t, str) and t.strip():
        return t.strip().strip('"')
    for line in body.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return fallback


def build_branch_index(reader: RepoContentReader, repo: str, branch: str,
                       path_prefix: str = DOCS_PREFIX) -> BranchIndex:
    """Scan ``path_prefix`` markdown on one branch and build its index (the S1 bootstrap).

    A single file whose content cannot be fetched is skipped (the read API marks it ``unavailable`` at
    serve time) — never all-or-nothing (``workspace-backend.md``). Two docs claiming the same
    ``(feature, kind)`` on the branch are both flagged ``duplicate`` rather than silently colliding.
    """
    candidates: list[tuple[dict, SpecRef]] = []
    unindexed: list[UnindexedDoc] = []
    for path in sorted(reader.list_tree(repo, branch, path_prefix)):
        if not path.endswith(".md"):
            continue
        try:
            obj = reader.get_contents(repo, path, branch)
        except Exception:
            continue
        ref = SpecRef(repo=repo, branch=branch, path=path, commit=obj.get("sha", ""))
        meta, body = parse_frontmatter(obj.get("content", ""))
        fields, reason = classify(meta, body)
        if reason:
            unindexed.append(UnindexedDoc(ref=ref, reason=reason))
        elif fields:
            candidates.append((fields, ref))

    # Detect (feature, kind) collisions across the branch; flag the colliding set, index the rest.
    by_key: dict[tuple[str, str], list[tuple[dict, SpecRef]]] = {}
    for fields, ref in candidates:
        by_key.setdefault((fields["feature"], fields["kind"]), []).append((fields, ref))
    specs: list[IndexedSpec] = []
    for (feature, kind), group in by_key.items():
        if len(group) > 1:
            unindexed += [UnindexedDoc(ref=ref, reason="duplicate (feature, kind) on branch")
                          for _, ref in group]
            continue
        fields, ref = group[0]
        specs.append(IndexedSpec(feature=feature, kind=kind, task=fields["task"],
                                 title=fields["title"], ref=ref))
    return BranchIndex(branch=branch, specs=specs, unindexed=unindexed)
