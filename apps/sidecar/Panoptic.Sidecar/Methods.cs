using System.Diagnostics;

namespace Panoptic.Sidecar;

/// <summary>What the sidecar reports about itself. StartupMs is process start to ready-to-read-stdin.</summary>
public sealed record SidecarInfo(double StartupMs, string Version, string Mode);

public static class Methods
{
    public static Dictionary<string, RpcHandler> Create(SidecarInfo info, ConfigStore? store = null, TreeService? tree = null)
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
                w.WriteEndObject();
            }),
        };

        if (store is null || tree is null) return methods;

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
            return Task.FromResult(Rpc.Result(store.Config, SidecarJson.Default.AppConfig));
        };

        methods["config.saveConnection"] = (p, _) =>
        {
            var args = Rpc.Params(p, SidecarJson.Default.SaveConnectionParams);
            store.SaveConnection(args.EnvironmentId, args.Connection, args.Secret);
            tree.Forget(args.Connection.Id);
            return Task.FromResult(Rpc.Result(store.Config, SidecarJson.Default.AppConfig));
        };

        methods["config.deleteConnection"] = (p, _) =>
        {
            var id = Rpc.Params(p, SidecarJson.Default.IdParams).Id;
            store.DeleteConnection(id);
            tree.Forget(id);
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

        methods["tree.children"] = async (p, ct) =>
        {
            var args = Rpc.Params(p, SidecarJson.Default.TreeChildrenParams);
            return Rpc.Result(await tree.ChildrenAsync(args.NodeId, ct), SidecarJson.Default.TreeNodeArray);
        };

        return methods;
    }
}
