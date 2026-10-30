using System.Diagnostics;

namespace Panoptic.Sidecar;

/// <summary>What the sidecar reports about itself. StartupMs is process start to ready-to-read-stdin.</summary>
public sealed record SidecarInfo(double StartupMs, string Version, string Mode);

public static class Methods
{
    public static Dictionary<string, RpcHandler> Create(SidecarInfo info, ConfigStore? store = null, TreeService? tree = null, Query.QueryService? query = null, Catalog.CatalogService? catalog = null)
    {
        var methods = new Dictionary<string, RpcHandler>
        {
            ["ping"] = (_, _) => Task.FromResult<Action<System.Text.Json.Utf8JsonWriter>>(w =>
            {
                w.WriteStartObject();
                w.WriteNumber("startupMs", info.StartupMs);
                w.WriteString("version", info.Version);
                w.WriteString("mode", info.Mode);
                w.WriteNumber("pid", Environment.ProcessId);
                if (store?.RecoveredFrom is { } recovered) w.WriteString("storeRecoveredFrom", recovered);
                w.WriteEndObject();
            }),
        };

        if (store is null || tree is null) return methods;

        methods["settings.get"] = (_, _) => Task.FromResult(Rpc.Result(store.Settings, SidecarJson.Default.AppSettings));

        methods["settings.save"] = (p, _) =>
        {
            store.SaveSettings(Rpc.Params(p, SidecarJson.Default.AppSettings));
            return Task.FromResult(Rpc.Result(store.Settings, SidecarJson.Default.AppSettings));
        };

        methods["config.get"] = (_, _) => Task.FromResult(Rpc.Result(store.Config, SidecarJson.Default.AppConfig));

        methods["config.saveEnvironment"] = (p, _) =>
        {
            store.SaveEnvironment(Rpc.Params(p, SidecarJson.Default.EnvironmentConfig));
            return Task.FromResult(Rpc.Result(store.Config, SidecarJson.Default.AppConfig));
        };

        methods["config.deleteEnvironment"] = (p, _) =>
        {
            var id = Rpc.Params(p, SidecarJson.Default.IdParams).Id;
            foreach (var c in store.FindEnvironment(id)?.Connections ?? []) tree.Forget(c.Id);
            store.DeleteEnvironment(id);
            catalog?.Forget();
            return Task.FromResult(Rpc.Result(store.Config, SidecarJson.Default.AppConfig));
        };

        methods["config.saveConnection"] = (p, _) =>
        {
            var args = Rpc.Params(p, SidecarJson.Default.SaveConnectionParams);
            store.SaveConnection(args.EnvironmentId, args.Connection, args.Secret);
            tree.Forget(args.Connection.Id);
            catalog?.Forget();
            return Task.FromResult(Rpc.Result(store.Config, SidecarJson.Default.AppConfig));
        };

        methods["config.deleteConnection"] = (p, _) =>
        {
            var id = Rpc.Params(p, SidecarJson.Default.IdParams).Id;
            store.DeleteConnection(id);
            tree.Forget(id);
            catalog?.Forget();
            return Task.FromResult(Rpc.Result(store.Config, SidecarJson.Default.AppConfig));
        };

        // Tests unsaved settings. A null secret means "use the stored one" (editing an existing connection).
        methods["connection.test"] = async (p, ct) =>
        {
            var args = Rpc.Params(p, SidecarJson.Default.TestConnectionParams);
            var secret = args.Secret ?? store.GetSecret(args.Connection.Id);
            var backend = tree.BackendFor(args.Connection);
            backend.Forget(args.Connection.Id);
            var sw = Stopwatch.StartNew();
            TestConnectionResult result;
            try
            {
                await backend.TestAsync(args.Connection, secret, ct);
                result = new TestConnectionResult(true, Math.Round(sw.Elapsed.TotalMilliseconds), null);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                result = new TestConnectionResult(false, Math.Round(sw.Elapsed.TotalMilliseconds), ex.Message);
            }
            finally
            {
                backend.Forget(args.Connection.Id);
            }
            return Rpc.Result(result, SidecarJson.Default.TestConnectionResult);
        };

        // Reads other tools' saved connections on this machine. Flags ones that are already in Panoptic.
        methods["import.scan"] = (_, _) =>
        {
            var existing = store.Config.Environments.SelectMany(e => e.Connections)
                .Select(c => Import.ImportKey.Of(c.Endpoint, c.User, c.Database))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var sources = Import.ConnectionImporter.Scan(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData))
                .Select(s => s with
                {
                    Groups = s.Groups.Select(g => g with
                    {
                        Connections = g.Connections
                            .Select(c => c with { AlreadyAdded = existing.Contains(Import.ImportKey.Of(c.Endpoint, c.User, c.Database)) })
                            .ToList(),
                    }).ToList(),
                })
                .ToArray();
            return Task.FromResult(Rpc.Result(sources, SidecarJson.Default.ImportSourceArray));
        };

        if (query is not null)
        {
            // Long-running: rows stream as query.rows notifications; this returns the summary at the end.
            methods["query.execute"] = async (p, ct) =>
                Rpc.Result(await query.ExecuteAsync(Rpc.Params(p, SidecarJson.Default.QueryRequest), ct), SidecarJson.Default.QuerySummary);

            methods["query.cancel"] = (p, _) =>
            {
                var cancelled = query.Cancel(Rpc.Params(p, SidecarJson.Default.QueryCancelParams).QueryId);
                return Task.FromResult<Action<System.Text.Json.Utf8JsonWriter>>(w => w.WriteBooleanValue(cancelled));
            };

            methods["query.template"] = (p, _) =>
            {
                var args = Rpc.Params(p, SidecarJson.Default.QueryTemplateParams);
                var target = tree.ResolveTarget(args.NodeId);
                var language = target.Connection.Kind == ConnectionKinds.Cosmos ? "cosmos" : "sql";
                var text = args.Action == "selectTop" ? Query.QueryTemplates.SelectTop(target.Connection.Kind, NodePath.Parse(args.NodeId)) : "";
                return Task.FromResult(Rpc.Result(new QueryTemplateResult(text, language), SidecarJson.Default.QueryTemplateResult));
            };
        }

        if (catalog is not null)
        {
            // Answer at once from memory or disk; a fresher catalog follows as a catalog.updated notification.
            methods["catalog.get"] = (p, _) =>
                Task.FromResult(Rpc.Result(catalog.Get(Rpc.Params(p, SidecarJson.Default.CatalogParams)), SidecarJson.Default.CatalogResult));

            methods["catalog.refresh"] = (p, _) =>
                Task.FromResult(Rpc.Result(catalog.Refresh(Rpc.Params(p, SidecarJson.Default.CatalogParams)), SidecarJson.Default.CatalogResult));
        }

        methods["tree.children"] = async (p, ct) =>
        {
            var args = Rpc.Params(p, SidecarJson.Default.TreeChildrenParams);
            return Rpc.Result(await tree.ChildrenAsync(args.NodeId, ct), SidecarJson.Default.TreeNodeArray);
        };

        return methods;
    }
}
