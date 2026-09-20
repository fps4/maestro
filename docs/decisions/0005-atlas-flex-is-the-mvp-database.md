# ADR-0005 · MongoDB Atlas Flex is the MVP database

**Status:** superseded by [ADR-0018](0018-dynamodb-is-the-mvp-database.md) · 2026-09-20 (accepted 2026-09-18)

## Context

The built components use MongoDB with transactions, a transactional outbox, text search, and one database per workspace, with a test suite that drives a real replica set. AWS has no scale-to-zero MongoDB. Three options: Atlas Flex (zero code change, a second vendor, pay per use), DocumentDB (native, fixed monthly cost, no scale-to-zero, limited text search), DynamoDB (native, near-zero idle, a rewrite of the storage layer and every query, no text search).

## Decision

**Atlas Flex**, on AWS with a private endpoint. No code change; every test still runs; pay per use. DynamoDB is a deliberate later step if single-vendor comes to matter more than the rewrite.

## Consequences

- A second vendor and a second bill; a VPC endpoint from Lambda.
- The components never learn which database they run on beyond the driver — a connection string and an adapter.

## What would reopen it

A tenant that requires single-vendor AWS; a cost at scale that DynamoDB would halve.
