# Connectors

One page per connector: what it shows in the tree, how it authenticates, and how its
connections are imported from other tools. All connectors implement the same node contract
(`apps/sidecar/Panoptic.Sidecar/Backends/IBackend.cs`), so the tree never knows which one it is
drawing.

| Connector | Connection kind | Page |
| --- | --- | --- |
| SQL Server, Azure SQL and Azure Synapse SQL | `sql`, `synapse` | [sql-server.md](sql-server.md) |
| Cosmos DB for NoSQL | `cosmos` | [cosmos.md](cosmos.md) |
| PostgreSQL, Azure Database for PostgreSQL (in progress) | `postgres` | [postgres.md](postgres.md) |
