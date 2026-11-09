using System.Diagnostics;

namespace Panoptic.Sidecar;

/// <summary>What the sidecar reports about itself. StartupMs is process start to ready-to-read-stdin.</summary>
public sealed record SidecarInfo(double StartupMs, string Version, string Mode);

public static class Methods
{
    public static Dictionary<string, RpcHandler> Create(SidecarInfo info, ConfigStore? store = null, TreeService? tree = null, Query.QueryService? query = null, Catalog.CatalogService? catalog = null, ProbeService? probes = null, ServerInfoService? server = null)
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
                if (store?.RestoredFromBackup == true) w.WriteBoolean("storeRestoredFromBackup", true);
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
            foreach (var c in store.FindEnvironment(id)?.Connections ?? [])
            {
                tree.Forget(c.Id);
                server?.Forget(c.Id);
            }
            store.DeleteEnvironment(id);
            catalog?.Forget();
            return Task.FromResult(Rpc.Result(store.Config, SidecarJson.Default.AppConfig));
        };

        methods["config.saveConnection"] = (p, _) =>
        {
            var args = Rpc.Params(p, SidecarJson.Default.SaveConnectionParams);
            tree.Validate(args.Connection);
            store.SaveConnection(args.EnvironmentId, args.Connection, args.Secret);
            tree.Forget(args.Connection.Id);
            server?.Forget(args.Connection.Id);
            catalog?.Forget();
            return Task.FromResult(Rpc.Result(store.Config, SidecarJson.Default.AppConfig));
        };

        // Drag and drop in the tree (#63): the connection itself is unchanged, so nothing about it is forgotten.
        methods["config.moveConnection"] = (p, _) =>
        {
            var args = Rpc.Params(p, SidecarJson.Default.MoveConnectionParams);
            store.MoveConnection(args.ConnectionId, args.EnvironmentId, args.BeforeId);
            return Task.FromResult(Rpc.Result(store.Config, SidecarJson.Default.AppConfig));
        };

        methods["config.deleteConnection"] = (p, _) =>
        {
            var id = Rpc.Params(p, SidecarJson.Default.IdParams).Id;
            store.DeleteConnection(id);
            tree.Forget(id);
            server?.Forget(id);
            catalog?.Forget();
            return Task.FromResult(Rpc.Result(store.Config, SidecarJson.Default.AppConfig));
        };

        // Undo of a delete: the config from before it, whose deleted secrets the store still holds.
        methods["config.restore"] = (p, _) =>
        {
            var config = Rpc.Params(p, SidecarJson.Default.AppConfig);
            if (config.Environments is null) throw new RpcException(RpcException.InvalidParams, "environments is required");
            foreach (var c in config.Environments.SelectMany(e => e.Connections ?? []).Concat(config.Connections)) tree.Validate(c);
            store.Restore(config);
            catalog?.Forget();
            return Task.FromResult(Rpc.Result(store.Config, SidecarJson.Default.AppConfig));
        };

        // A delete stands (its undo window closed): drop the deleted connections' secrets and catalog snapshots.
        methods["config.purgeSecrets"] = (p, _) =>
        {
            var ids = Rpc.Params(p, SidecarJson.Default.PurgeSecretsParams).ConnectionIds ?? [];
            store.PurgeSecrets(ids);
            var live = store.ConnectionIds();
            catalog?.Remove(ids.Where(id => !live.Contains(id)));
            return Task.FromResult<Action<System.Text.Json.Utf8JsonWriter>>(w => w.WriteBooleanValue(true));
        };

        // Tests unsaved settings. A null secret means "use the stored one" (editing an existing connection), but only
        // while the edit still points where it was saved for: never send it to a changed host, user or sign-in.
        methods["connection.test"] = async (p, ct) =>
        {
            var args = Rpc.Params(p, SidecarJson.Default.TestConnectionParams);
            var backend = tree.Validate(args.Connection);
            var secret = args.Secret ?? store.GetSecretFor(args.Connection);
            backend.Forget(args.Connection.Id);
            var sw = Stopwatch.StartNew();
            TestConnectionResult result;
            try
            {
                await backend.TestAsync(args.Connection, secret, ct);
                result = new TestConnectionResult(true, Math.Round(sw.Elapsed.TotalMilliseconds), null);
            }
            // Cancelled: let it reach the dispatcher, which answers RequestCancelled, rather than report a failed test.
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                // Our own refusals are already plain; anything else gets its root cause on the line too (#192).
                var error = ex is RpcException ? ex.Message : NodeErrors.OneLine(ex);
                result = new TestConnectionResult(false, Math.Round(sw.Elapsed.TotalMilliseconds), error);
            }
            finally
            {
                backend.Forget(args.Connection.Id);
                // A test is not a session: it may have run with unsaved settings.
                server?.Forget(args.Connection.Id);
            }
            return Rpc.Result(result, SidecarJson.Default.TestConnectionResult);
        };

        // Reachability for the environment pane (docs/environment-pane.md): saved connections only, by id, so the UI
        // never names a host to contact.
        probes ??= new ProbeService(store, tree.BackendFor, new NetworkProbe(), TimeProvider.System);
        methods["connection.probe"] = async (p, ct) =>
        {
            var args = Rpc.Params(p, SidecarJson.Default.ProbeParams);
            return Rpc.Result(await probes.ProbeAsync(args.ConnectionIds, args.Fresh, ct), SidecarJson.Default.ProbeResultArray);
        };

        // The connection pane's About card, Connected and Session tiles and Needs attention (docs/connection-pane.md):
        // from the sidecar's own records, so asking runs nothing on the server; Refresh describes it again once a
        // session has opened. connection.serverUpdated says when a describe has finished.
        if (server is not null)
            methods["connection.server"] = async (p, ct) =>
            {
                var args = Rpc.Params(p, SidecarJson.Default.ServerParams);
                return Rpc.Result(await server.GetAsync(args.ConnectionId, args.Refresh, ct), SidecarJson.Default.ServerState);
            };

        // Saved connections to and from one file (#28, ADR 0008): no secrets, merged on import. The sidecar reads and
        // writes the file itself, so the UI needs no file access and the format stays in one place.
        methods["backup.export"] = (p, _) =>
        {
            var args = Rpc.Params(p, SidecarJson.Default.BackupPathParams);
            return Task.FromResult(Rpc.Result(Backup.ConnectionBackup.Export(store, args.Path), SidecarJson.Default.BackupExportResult));
        };
        methods["backup.read"] = (p, _) =>
        {
            var args = Rpc.Params(p, SidecarJson.Default.BackupPathParams);
            return Task.FromResult(Rpc.Result(Backup.ConnectionBackup.Preview(store, tree, Backup.ConnectionBackup.Read(args.Path)), SidecarJson.Default.BackupPreview));
        };
        methods["backup.import"] = (p, _) =>
        {
            var args = Rpc.Params(p, SidecarJson.Default.BackupImportParams);
            var result = Backup.ConnectionBackup.Import(store, tree, Backup.ConnectionBackup.Read(args.Path), args.Connections);
            catalog?.Forget();
            return Task.FromResult(Rpc.Result(result, SidecarJson.Default.BackupImportResult));
        };

        // Reads other tools' saved connections on this machine. Flags ones that are already in Panoptic.
        Import.ImportSource MarkAdded(Import.ImportSource source)
        {
            var existing = store.Config.Environments.SelectMany(e => e.Connections).Concat(store.Config.Connections)
                .Select(c => Import.ImportKey.Of(c.Endpoint, c.User, c.Database))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            return source with
            {
                Groups = source.Groups.Select(g => g with
                {
                    Connections = g.Connections
                        .Select(c => c with { AlreadyAdded = existing.Contains(Import.ImportKey.Of(c.Endpoint, c.User, c.Database)) })
                        .ToList(),
                }).ToList(),
            };
        }

        methods["import.scan"] = (_, _) =>
        {
            var sources = Import.ConnectionImporter.Scan(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData))
                .Select(MarkAdded)
                .ToArray();
            return Task.FromResult(Rpc.Result(sources, SidecarJson.Default.ImportSourceArray));
        };

        // A file the user picked (#25): an exported .regsrvr, a RegSrvr or UserSettings .xml, or a settings.json.
        methods["import.scanFile"] = (p, _) =>
        {
            var path = Rpc.Params(p, SidecarJson.Default.ImportFileParams).Path;
            return Task.FromResult(Rpc.Result(MarkAdded(Import.ConnectionImporter.ScanFile(path)), SidecarJson.Default.ImportSource));
        };

        // The values-free structure report the import dialog copies for an issue (#25).
        methods["import.diagnostics"] = (_, _) =>
        {
            var report = Import.ConnectionImporter.Diagnostics(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                info.Version);
            return Task.FromResult<Action<System.Text.Json.Utf8JsonWriter>>(w => w.WriteStringValue(report));
        };

        if (query is not null)
        {
            // Long-running: rows stream as query.rows notifications; this returns the summary at the end.
            methods["query.execute"] = async (p, ct) =>
                Rpc.Result(await query.ExecuteAsync(Rpc.Params(p, SidecarJson.Default.QueryRequest), ct), SidecarJson.Default.QuerySummary);

            methods["query.saveAll"] = async (p, ct) =>
                Rpc.Result(await query.SaveAsync(Rpc.Params(p, SidecarJson.Default.QuerySaveRequest), ct), SidecarJson.Default.QuerySaveResult);

            methods["query.cancel"] = (p, _) =>
            {
                var cancelled = query.Cancel(Rpc.Params(p, SidecarJson.Default.QueryCancelParams).QueryId);
                return Task.FromResult<Action<System.Text.Json.Utf8JsonWriter>>(w => w.WriteBooleanValue(cancelled));
            };

            methods["query.template"] = (p, _) =>
            {
                var args = Rpc.Params(p, SidecarJson.Default.QueryTemplateParams);
                var target = tree.ResolveTarget(args.NodeId);
                var backend = tree.QueryBackendFor(target.Connection, "cannot run queries");
                var text = backend.TemplateFor(NodePath.Parse(args.NodeId), args.Action);
                return Task.FromResult(Rpc.Result(new QueryTemplateResult(text, backend.EditorLanguage, tree.ScopeOf(args.NodeId), backend.Capabilities),
                    SidecarJson.Default.QueryTemplateResult));
            };

            // The connection, database and container a node's query tabs belong to, for refreshing their catalogs.
            methods["query.scope"] = (p, _) =>
                Task.FromResult(Rpc.Result(tree.ScopeOf(Rpc.Params(p, SidecarJson.Default.NodeScopeParams).NodeId), SidecarJson.Default.QueryScope));
        }

        if (catalog is not null)
        {
            // Answer at once from memory or disk; a fresher catalog follows as a catalog.updated notification.
            methods["catalog.get"] = (p, _) =>
                Task.FromResult(Rpc.Result(catalog.Get(Rpc.Params(p, SidecarJson.Default.CatalogParams)), SidecarJson.Default.CatalogResult));

            methods["catalog.refresh"] = (p, _) =>
                Task.FromResult(Rpc.Result(catalog.Refresh(Rpc.Params(p, SidecarJson.Default.CatalogParams)), SidecarJson.Default.CatalogResult));
        }

        // Labels for the context menu: the UI renders a node's action ids with these.
        methods["node.actionLabels"] = (_, _) => Task.FromResult(Rpc.Result(tree.ActionLabels(), SidecarJson.Default.DictionaryStringString));

        // Each connection kind as the UI shows it: labels, badge, auths and optional fields (#203).
        methods["backends.describe"] = (_, _) => Task.FromResult(Rpc.Result(tree.Describe(), SidecarJson.Default.KindDescriptionArray));

        // Actions a backend adds, performed in the sidecar (no built-in backend has one). Null text: nothing to copy.
        methods["node.invoke"] = async (p, ct) =>
        {
            var args = Rpc.Params(p, SidecarJson.Default.NodeInvokeParams);
            return Rpc.Result(new NodeInvokeResult(await tree.InvokeAsync(args.NodeId, args.ActionId, ct)), SidecarJson.Default.NodeInvokeResult);
        };

        methods["tree.children"] = async (p, ct) =>
        {
            var args = Rpc.Params(p, SidecarJson.Default.TreeChildrenParams);
            return Rpc.Result(await tree.ChildrenAsync(args.NodeId, ct), SidecarJson.Default.TreeNodeArray);
        };

        return methods;
    }
}
