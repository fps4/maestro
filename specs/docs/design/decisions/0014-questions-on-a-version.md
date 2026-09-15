---
title: "0014: A question on a version is a fact about it, not a comment; asked by anyone, answered by anyone, closed by a human, never a mutation"
summary: "Reviewers get one channel short of `request_changes`: a question attached to an immutable version. It never changes the version's bytes or digest, it is attributed and on the record, an agent may answer it (marked as an agent's answer), and only a human closes it. A gate may declare `questions_resolved` to hold shut while one is open; undeclared, open questions are shown and never block. This narrows, and does not repeal, 'not a wiki'."
status: proposed
last_updated: 2026-09-15
date: 2026-09-15
related:
  - ./0003-immutable-versions-mutable-drafts.md
  - ./0005-agents-may-author-never-decide.md
  - ./0013-the-decision-page-is-the-product.md
  - ../architecture.md
---

## Context

Architecture §10 names the wiki as the failure mode to guard against and refuses comments, page
trees, templates and freeform spaces: *the editor exists to produce a version that a gate will
decide on.* That line is right, and it threw out one thing it should not have.

A reviewer reading a version has, today, exactly one way to say "I don't understand this line":
the `request_changes` outcome — a gate decision, recorded, reopening a draft, carrying their
reasoning. That is the right instrument for "change this". It is far too heavy for "what does
*per project* mean here?", so that question is asked on Slack or in a corridor, answered there, and
the record never learns that the sponsor approved something they had not understood until someone
explained it off the record. The audit chain has a hole exactly where a non-technical reviewer's
comprehension lives.

The same gap blocks the most useful thing an agent can do for a non-technical reviewer: answer the
question. There was nowhere to ask it.

## Decision

**A question is admitted, narrowly, as a fact about a version.**

- It attaches to an **immutable version** and never to a draft. A draft has an editor; a question
  on a draft would be a comment, and comments stay refused.
- It **never mutates the version**. The bytes, the digest, the state and the decision that cites
  them are untouched. A question is to a version what a decision is: something recorded *about* it.
- **Anyone in the workspace may ask** — human or agent, and the kind is recorded.
- **Anyone may answer**, and an agent's answer is marked as an agent's. This is the interpreter
  role ADR-0013 left open: a sponsor asks at 22:00 and has an answer, cited to the version or a
  standard, at 22:01.
- **Only a human closes a question**, and closing records who. This is the line ADR-0005 draws for
  confirming an extraction, drawn again: an agent may do the work, and a person says it is done.
- Every change is an event on the record sink — `QuestionRaised`, `QuestionAnswered`,
  `QuestionResolved` — carrying the question id and a **digest of the text, never the text**. A
  question routinely names a person; the text stays in the workspace under its retention.

**A gate may declare `requires.questions_resolved`.** Declared, it holds the gate shut while a
question on the version is open, and the requirement appears in the checklist like any other.
Undeclared, open questions are shown prominently on the decision page and in the packet and never
block. The committed definition declares it on the specification gate — nothing gets built with a
reviewer's question open — and not on Explore, where an open question is a reason to ask for
changes rather than to hold the gate.

**Over MCP: `list_questions`, `ask_question`, `answer_question`. No tool closes one.**

## Consequences

**"Not a wiki" is narrowed, not repealed.** The test becomes: *anything attached to a version is a
fact about it — a decision, an evaluation, a question — and never a change to it.* Page trees,
freeform spaces, and comments on drafts remain out, for the reasons §10 gives.

**Questions are not proposals and not decisions.** They do not go through a gate and do not need a
named human to raise. They need a human to *close*, which is a weaker and correctly-placed
requirement.

**A closed question stays readable.** Nothing here is deleted; redaction of a question's text under
an erasure request follows the same shape as body redaction and is not built yet.

**The decision page now has its missing section.** The ADR-0013 packet carries `questions`, and
the page asks the reviewer to ask rather than to decide on a guess.

**Volume.** A question is commitment-shaped, not keystroke-shaped: one event per question, per
answer, per close. If the event rate ever tracks conversation rather than review, the boundary has
been crossed and the fix is to refuse, not to filter.
