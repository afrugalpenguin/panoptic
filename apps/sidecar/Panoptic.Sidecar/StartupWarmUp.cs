using System.Text.Json;

namespace Panoptic.Sidecar;

/// <summary>
/// The shell starts the sidecar before it creates its window, so the sidecar is ready a couple of hundred ms before the
/// UI sends its first requests. This runs those requests (App.svelte: ping, backends.describe, node.actionLabels,
/// config.get, then tree.children for the root and an environment) once in that gap, replies discarded, so their code
/// is already JIT-compiled when the UI asks (ADR 0001: the sidecar ships JIT, not ReadyToRun). All of them only read
/// the store; none reaches a server.
/// </summary>
public static class StartupWarmUp
{
    public static async Task RunAsync(JsonRpcDispatcher dispatcher, AppConfig config)
    {
        string?[] lines =
        [
            Request("ping"),
            Request("backends.describe"),
            Request("node.actionLabels"),
            Request("config.get"),
            Request("tree.children", new TreeChildrenParams("")),
            config.Environments.FirstOrDefault() is { } env ? Request("tree.children", new TreeChildrenParams(NodePath.Root.Child("env", env.Id).Id)) : null,
        ];
        // One at a time: the point is compiling each path once, not loading the thread pool while the shell starts.
        // The dispatcher turns a failure into an error reply, which is discarded with the rest.
        foreach (var line in lines)
            if (line is not null) await dispatcher.HandleAsync(line);
    }

    // A string id, so it can never match one of the UI's numeric ids in the dispatcher's cancellation table.
    private static string Request(string method, TreeChildrenParams? parameters = null) =>
        parameters is null
            ? $$"""{"jsonrpc":"2.0","id":"warm-up","method":"{{method}}"}"""
            : $$"""{"jsonrpc":"2.0","id":"warm-up","method":"{{method}}","params":{{JsonSerializer.Serialize(parameters, SidecarJson.Default.TreeChildrenParams)}}}""";
}
