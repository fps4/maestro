# Test run reports

Timestamped acceptance-test evidence, one markdown file per run. These are evidence, not source — the folder is git-ignored except this README (see `.gitignore`).

## Naming convention

```
YYYY-MM-DD-HHMM-US-XXXX[-suffix].md
```

## Required contents (per docs/guides/documentation-standards.md)

Every report must contain:

- Run metadata (date, host, agent)
- Summary table — one row per scenario (result + one-line note for failures)
- Failure details — for each failed scenario: the step that failed, expected vs actual, log excerpt
- Board state snapshot — card text as it stands at end of run
- Next actions — concrete, actionable items

## Retention

Reports are kept until the corresponding user story is `done` and stable; prune older runs for a story once its successor run supersedes them.
