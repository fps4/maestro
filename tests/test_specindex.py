"""The frontmatter spec index (ADR-0018): parse, validate the ``maestro:`` block, build a branch index.

Frontmatter *is* the index — so the contract it enforces (what is indexed, what is flagged, what is
ignored) is the load-bearing behaviour these tests pin.
"""
from orchestrator.specindex import (
    KIND_FUNCTIONAL,
    KIND_TECHNICAL,
    build_branch_index,
    classify,
    parse_frontmatter,
)


def _doc(maestro: str = "", title="Title", body="# Title\n\ntext"):
    fm = f"maestro:\n{maestro}" if maestro else ""
    return f"---\ntitle: {title}\n{fm}\n---\n{body}"


# --- parse_frontmatter -------------------------------------------------------------------------

def test_parse_splits_frontmatter_from_body():
    meta, body = parse_frontmatter("---\ntitle: Hi\n---\n# Hi\nbody")
    assert meta == {"title": "Hi"}
    assert body.strip() == "# Hi\nbody"


def test_parse_no_frontmatter_returns_none():
    meta, body = parse_frontmatter("# Just a doc\nno frontmatter")
    assert meta is None and body.startswith("# Just a doc")


def test_parse_malformed_yaml_does_not_raise():
    meta, _ = parse_frontmatter("---\n:\n  - broken: [\n---\nbody")
    assert meta is None  # malformed → None, never an exception


# --- classify ----------------------------------------------------------------------------------

def test_classify_indexes_a_valid_spec():
    meta, body = parse_frontmatter(_doc("  feature: invoice-export\n  kind: functional_spec\n  task: US-0042"))
    fields, reason = classify(meta, body)
    assert reason is None
    assert fields == {"feature": "invoice-export", "kind": KIND_FUNCTIONAL,
                      "task": "US-0042", "title": "Title"}


def test_classify_task_is_optional():
    meta, body = parse_frontmatter(_doc("  feature: invoice-export\n  kind: technical_design"))
    fields, reason = classify(meta, body)
    assert reason is None and fields["task"] is None and fields["kind"] == KIND_TECHNICAL


def test_classify_plain_doc_is_ignored_not_flagged():
    # No maestro: block → not a spec → both None (silently skipped, not unindexed noise).
    meta, body = parse_frontmatter("---\ntitle: A guide\n---\n# A guide")
    assert classify(meta, body) == (None, None)


def test_classify_flags_bad_kind():
    meta, body = parse_frontmatter(_doc("  feature: x\n  kind: nonsense"))
    _, reason = classify(meta, body)
    assert reason == "malformed maestro: frontmatter (kind)"


def test_classify_flags_bad_feature():
    meta, body = parse_frontmatter(_doc("  feature: Not A Slug\n  kind: functional_spec"))
    _, reason = classify(meta, body)
    assert reason == "malformed maestro: frontmatter (feature)"


def test_classify_flags_bad_task_format():
    meta, body = parse_frontmatter(_doc("  feature: x\n  kind: functional_spec\n  task: 42"))
    _, reason = classify(meta, body)
    assert reason == "malformed maestro: frontmatter (task)"


# --- build_branch_index ------------------------------------------------------------------------

def test_build_indexes_specs_and_ignores_plain_docs(content_reader):
    r = (content_reader
         .put("acme/widget", "main", "docs/spec.md",
              _doc("  feature: invoice-export\n  kind: functional_spec"))
         .put("acme/widget", "main", "docs/guides/setup.md", "# Setup\nno frontmatter")
         .put("acme/widget", "main", "docs/README.md", "---\ntitle: Index\n---\n# Index"))
    idx = build_branch_index(r, "acme/widget", "main")
    assert [s.feature for s in idx.specs] == ["invoice-export"]
    assert idx.specs[0].ref.path == "docs/spec.md"
    assert idx.unindexed == []  # plain docs are ignored, not flagged


def test_build_flags_malformed_but_serves_the_rest(content_reader):
    r = (content_reader
         .put("acme/widget", "main", "docs/good.md",
              _doc("  feature: good\n  kind: functional_spec"))
         .put("acme/widget", "main", "docs/bad.md", _doc("  feature: bad\n  kind: oops")))
    idx = build_branch_index(r, "acme/widget", "main")
    assert [s.feature for s in idx.specs] == ["good"]
    assert len(idx.unindexed) == 1 and idx.unindexed[0].ref.path == "docs/bad.md"


def test_build_flags_duplicate_feature_kind(content_reader):
    r = (content_reader
         .put("acme/widget", "main", "docs/a.md", _doc("  feature: dup\n  kind: functional_spec"))
         .put("acme/widget", "main", "docs/b.md", _doc("  feature: dup\n  kind: functional_spec")))
    idx = build_branch_index(r, "acme/widget", "main")
    assert idx.specs == []  # neither wins
    assert {u.reason for u in idx.unindexed} == {"duplicate (feature, kind) on branch"}
    assert len(idx.unindexed) == 2


def test_build_skips_non_markdown(content_reader):
    r = content_reader.put("acme/widget", "main", "docs/diagram.png", "binary-ish")
    assert build_branch_index(r, "acme/widget", "main").specs == []
