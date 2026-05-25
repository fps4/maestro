<!-- maestro PR template — see standards/git.yaml and docs/guides/sdlc.md -->

## What & why

<!-- One paragraph: what this changes and the intent behind it. -->

## Traceability (required)

- Delivery task / issue:
- Approved spec / design:
- Acceptance criteria (requirements) this PR satisfies:

## Definition of Done

- [ ] Satisfies its acceptance criteria, with tests proving it
- [ ] Unit / integration / e2e pass; coverage maintained or improved
- [ ] SAST, dependency, and secret scans clean (no new high-severity findings)
- [ ] Every added dependency exists and is the intended package (no hallucinated deps)
- [ ] Licenses compatible; SBOM updated
- [ ] Docs affected by this change updated in the same PR

## Automated-gate status

<!-- Confirm CI gate results. The technical merge gate opens only when these are green. -->

---
This PR is on a `maestro/*` branch (if agent-authored) and does not merge itself. A human merges (ADR-0004).
