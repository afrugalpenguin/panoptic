# 0002. v1 covers SQL Server and Cosmos DB under one tree

- Status: Accepted
- Date: 2026-10-29

## Context

The multi-backend, environment-first tree is the part no vendor sells. A tree built for one backend first tends to become shaped like that backend.

## Decision

v1 ships SQL Server and Cosmos DB for NoSQL at equal depth, both behind the same node contract. Admin surfaces, a general editor, write-heavy editing and Cenata-specific connectors are out of scope.

## Consequences

Two very different backends prove the node contract early. Anything admin-shaped gets a deep link to SSMS instead of an implementation.
