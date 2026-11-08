using System.Text.Json;

namespace Panoptic.Sidecar.Tests;

public class StartupWarmUpTests
{
    [Fact]
    public async Task Runs_the_uis_first_requests_and_nothing_else()
    {
        var calls = new List<(string Method, string? Params)>();
        RpcHandler Record(string method) => (p, _) =>
        {
            lock (calls) calls.Add((method, p?.GetRawText()));
            return Task.FromResult<Action<Utf8JsonWriter>>(w => w.WriteNullValue());
        };
        var all = new[] { "ping", "backends.describe", "node.actionLabels", "config.get", "tree.children", "config.deleteEnvironment" };
        var dispatcher = new JsonRpcDispatcher(all.ToDictionary(m => m, Record));
        var config = new AppConfig([new EnvironmentConfig("e1", "Dev", "#fff", false, [])]);

        await StartupWarmUp.RunAsync(dispatcher, config);

        Assert.Equal(
            [
                ("ping", null),
                ("backends.describe", null),
                ("node.actionLabels", null),
                ("config.get", null),
                ("tree.children", """{"nodeId":""}"""),
                ("tree.children", """{"nodeId":"env:e1"}"""),
            ],
            calls);
    }

    [Fact]
    public async Task With_no_environments_warms_only_the_root()
    {
        var methods = new List<string>();
        var dispatcher = new JsonRpcDispatcher(new Dictionary<string, RpcHandler>
        {
            ["tree.children"] = (p, _) =>
            {
                methods.Add(p!.Value.GetRawText());
                return Task.FromResult<Action<Utf8JsonWriter>>(w => w.WriteNullValue());
            },
        });

        await StartupWarmUp.RunAsync(dispatcher, new AppConfig([]));

        Assert.Equal(["""{"nodeId":""}"""], methods);
    }

    [Fact]
    public async Task A_failing_request_does_not_stop_the_rest()
    {
        var methods = new List<string>();
        var dispatcher = new JsonRpcDispatcher(new Dictionary<string, RpcHandler>
        {
            ["ping"] = (_, _) => throw new InvalidOperationException("boom"),
            ["config.get"] = (_, _) =>
            {
                methods.Add("config.get");
                return Task.FromResult<Action<Utf8JsonWriter>>(w => w.WriteNullValue());
            },
        }, _ => { });

        await StartupWarmUp.RunAsync(dispatcher, new AppConfig([]));

        Assert.Equal(["config.get"], methods);
    }
}
