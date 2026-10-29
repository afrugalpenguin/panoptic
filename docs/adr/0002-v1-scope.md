# 0002. v1 covers SQL Server, Cosmos DB and Synapse under one tree

- Status: Accepted
- Date: 2026-10-29

## Context

The multi-backend, environment-first tree is the part no vendor sells. A tree built for one backend first tends to become shaped like that backend.

## Decision

v1 is a working SSMS replacement: SQL Server, Cosmos DB for NoSQL and Azure Synapse SQL pools, all behind the same node contract. Synapse speaks TDS and reuses the SQL Server backend with its catalog differences. Other engines come later through the same contract. Admin surfaces, a general editor, write-heavy editing, cross-environment diff and Cenata-specific connectors are out of scope for v1.

## Consequences

Two very different backends prove the node contract early. Anything admin-shaped gets a deep link to SSMS instead of an implementation.
