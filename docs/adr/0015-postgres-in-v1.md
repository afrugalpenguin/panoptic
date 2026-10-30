# 0015. v1 adds PostgreSQL

- Status: Accepted
- Date: 2026-10-30
- Amends: 0002

## Context

ADR 0002 put SQL Server, Cosmos DB and Synapse in v1 and left other engines for later. Databases Panoptic needs to reach day to day now include PostgreSQL, typically Azure Database for PostgreSQL with Entra sign-in, so without Postgres it cannot replace the tools in use. The node contract (`IBackend`, `IQueryBackend`) was built so a third backend is one class and one registry line; `BackendContractTests` already holds a stand-in for it.

## Decision

PostgreSQL is a v1 backend at parity with SQL Server: tree, query editor with streamed results and cancel, Select top 1000, copy name, the read-only guard (enforced by the server through read-only transactions) and IntelliSense through a `pgsql` dialect of the existing engine. The driver is Npgsql. Auth is Entra and username/password first; client certificates, AWS RDS IAM and Kerberos follow as separate issues. Because SQL Server users are the audience, the `pgsql` editor also warns about T-SQL habits (TOP, brackets, GETDATE and similar) and offers fixes. The design is in docs/plans/2026-10-30-postgres-design.md.

## Consequences

A fourth backend lands before the M3 and M4 work, so v1 moves later by the size of that work. The IntelliSense engine becomes dialect-aware rather than T-SQL only, which is also the shape any further SQL engine would need. CI gains a Postgres integration job.
