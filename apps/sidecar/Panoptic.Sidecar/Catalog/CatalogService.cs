using System.Collections.Concurrent;
using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Catalog;

public interface ICatalogSource
{
    /// <summary>A cheap value that changes when the database's objects change. Null when there is no cheap check
    /// (Cosmos): the catalog is then rebuilt once per session.</summary>
    Task<string?> StampAsync(QueryTarget target, CancellationToken ct);

    Task<DatabaseCatalog> BuildAsync(QueryTarget target, CancellationToken ct);
}

/// <summary>
/// Serves catalogs cache-first (docs/query-editor.md). Get answers at once from memory or disk and checks the
/// stamp in the background; anything that follows arrives as a notification:
///   catalog.state   { key, state, message? }   current (cached copy confirmed) or error
///   catalog.updated { key, state, catalog }    a freshly built catalog replaces the old one
/// One build per key at a time; requests that arrive meanwhile join it.
/// </summary>
public sealed class CatalogService(Func<CatalogParams, QueryTarget> resolve, CatalogCache cache, ICatalogSource source, Action<string, CatalogNotice> notify)
{
    /// <summary>Catalogs confirmed or built this session.</summary>
    private readonly ConcurrentDictionary<string, DatabaseCatalog> _current = new();
    private readonly Dictionary<string, Task> _work = [];

    public CatalogResult Get(CatalogParams p)
    {
        var target = resolve(p);
        var key = CatalogCache.KeyOf(target.Connection.Id, target.Database);
        if (_current.TryGetValue(key, out var current)) return new(key, CatalogStates.Current, current);

        var cached = cache.Read(key);
        Start(key, target, cached, force: false);
        return cached is null ? new(key, CatalogStates.Building, null) : new(key, CatalogStates.Cached, cached);
    }

    /// <summary>Rebuilds (Cosmos re-samples) whatever the stamp says. The UI keeps its current catalog until catalog.updated.</summary>
    public CatalogResult Refresh(CatalogParams p)
    {
        var target = resolve(p);
        var key = CatalogCache.KeyOf(target.Connection.Id, target.Database);
        Start(key, target, null, force: true);
        return new(key, CatalogStates.Building, null);
    }

    /// <summary>A connection changed or was removed: re-check every catalog on its next use.</summary>
    public void Forget() => _current.Clear();

    private void Start(string key, QueryTarget target, DatabaseCatalog? cached, bool force)
    {
        lock (_work)
        {
            if (_work.ContainsKey(key)) return;
            _work[key] = Task.Run(async () =>
            {
                CatalogNotice notice;
                try
                {
                    notice = await Work(key, target, cached, force);
                }
                catch (Exception ex)
                {
                    notice = new(key, CatalogStates.Error, Message: ex.Message);
                }
                // Done before notifying, so a request prompted by the notice starts new work instead of joining this.
                lock (_work) _work.Remove(key);
                notify(notice.Catalog is null ? "catalog.state" : "catalog.updated", notice);
            });
        }
    }

    private async Task<CatalogNotice> Work(string key, QueryTarget target, DatabaseCatalog? cached, bool force)
    {
        if (!force && cached is not null && await source.StampAsync(target, CancellationToken.None) is { } stamp && stamp == cached.Stamp)
        {
            _current[key] = cached;
            return new(key, CatalogStates.Current);
        }
        var built = await source.BuildAsync(target, CancellationToken.None);
        cache.Write(key, built);
        _current[key] = built;
        return new(key, CatalogStates.Current, built);
    }
}

/// <summary>Catalog builds against the real backends: whichever one serves the target's connection kind.</summary>
public sealed class CatalogSources(ConfigStore store, TreeService tree) : ICatalogSource
{
    private const string NoCatalog = "have no IntelliSense catalog";

    public Task<string?> StampAsync(QueryTarget target, CancellationToken ct) =>
        tree.QueryBackendFor(target.Connection, NoCatalog).CatalogStampAsync(target, store.GetSecret(target.Connection.Id), ct);

    public Task<DatabaseCatalog> BuildAsync(QueryTarget target, CancellationToken ct) =>
        tree.QueryBackendFor(target.Connection, NoCatalog).CatalogAsync(target, store.GetSecret(target.Connection.Id), store.Settings.Editor, ct);
}
