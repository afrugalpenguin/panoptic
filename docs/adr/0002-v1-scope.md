# 0002. v1 covers SQL Server, Cosmos DB and Synapse under one tree

- Status: Accepted (amended by 0015: PostgreSQL is also in v1; wording amended 2026-11-08)
- Recorded: 2026-10-29

## Context

The multi-backend, environment-first tree is the part no vendor sells. A tree built for one backend first tends to become shaped like that backend.

## Decision

v1 is a working SSMS replacement: SQL Server, Cosmos DB for NoSQL and Azure Synapse SQL pools, all behind the same node contract. Synapse speaks TDS and reuses the SQL Server backend with its catalog differences. Other engines come later through the same contract. Admin surfaces, a general editor, write-heavy editing and cross-environment diff are out of scope for v1.

Amended 2026-11-08: "SSMS replacement" is the positioning as first recorded. Since #166 Panoptic is described as a cross-environment, cross-engine database tool: the tree, query pane and grid for every engine and environment at once, with admin surfaces left to the vendor tools (plan.md, README). The scope above is unchanged.

## Consequences

Two very different backends prove the node contract early. Anything admin-shaped gets a deep link to SSMS instead of an implementation.
