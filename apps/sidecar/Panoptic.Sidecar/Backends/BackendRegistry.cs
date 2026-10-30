namespace Panoptic.Sidecar.Backends;

/// <summary>
/// Every connection kind and the backend that serves it: the one place a backend is registered. TreeService,
/// QueryService, CatalogSources and the RPC methods all find backends through this map, so a new backend is its own
/// class plus one line here.
/// </summary>
public static class BackendRegistry
{
    public static Dictionary<string, IBackend> Create(Credentials credentials)
    {
        var sql = new SqlBackend(credentials);
        return new()
        {
            [ConnectionKinds.Sql] = sql,
            [ConnectionKinds.Synapse] = sql,
            [ConnectionKinds.Cosmos] = new CosmosBackend(credentials),
            [ConnectionKinds.Postgres] = new PostgresBackend(credentials),
        };
    }
}
