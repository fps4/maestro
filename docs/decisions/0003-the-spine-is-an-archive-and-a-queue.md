# ADR-0003 · The spine is an S3 archive with SNS/SQS delivery; the relay ships first

**Status:** accepted · 2026-09-18

## Context

The record needs four things: the archive is the system of record and the log is only a write path; tamper evidence is computed in code, never procured; the sequence is assigned by the writing service, never read from a broker's offset; volume is tiny by construction. Kafka gives throughput and consumer-group replay for a volume this record will never have. RabbitMQ is a server to run with no advantage over SQS for transient transport. Every built component already has a transactional outbox — an ordered, per-workspace, durable log.

## Decision

Each component's outbox → a scheduled **relay** → an **S3 archive** (daily sealed segments per workspace, Merkle chain over canonical JSON computed in code, Object Lock as defence in depth) → **SNS FIFO → SQS FIFO** per consumer, message group = workspace. Replay reads the archive, never the queue. Kafka and RabbitMQ are not adopted.

**The archive relay ships before any consumer.** A queue with fourteen-day retention is a fine transport and a terrible record.

## Consequences

- Every component database is a projection; dropping and rebuilding it from the archive is a build gate.
- Exit is the archive plus the verifier ([ADR-0004](0004-exit-is-the-portable-export.md)).
- Events carry no free text; anything personal is a payload reference with a digest, so the archive can be immutable and erasure still honoured.

## What would reopen it

Event volume that tracks activity rather than commitments — which is a defect in the emitting component, not an argument for a broker.
