using System.Diagnostics;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Panoptic.Sidecar;
using Panoptic.Sidecar.Backends;

// stdout carries protocol traffic only; anything diagnostic goes to stderr.
var assembly = typeof(Methods).Assembly;
var mode = assembly.GetCustomAttributes<AssemblyMetadataAttribute>().FirstOrDefault(a => a.Key == "PublishMode")?.Value ?? "dev";
var version = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0] ?? "0.0.0";

using var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
using var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true, NewLine = "\n" };
var writeLock = new SemaphoreSlim(1, 1);

async Task WriteLine(string line)
{
    await writeLock.WaitAsync();
    try { await stdout.WriteLineAsync(line); }
    finally { writeLock.Release(); }
}

void Notify(string method, Action<Utf8JsonWriter> parameters) => _ = WriteLine(JsonRpcDispatcher.Notification(method, parameters));

var credentials = new Credentials(prompt =>
    Notify("auth.deviceCode", w => JsonSerializer.Serialize(w, prompt, SidecarJson.Default.DeviceCodePrompt)));
var store = new ConfigStore(Environment.GetEnvironmentVariable("PANOPTIC_STORE") ?? ConfigStore.DefaultPath);
var tree = new TreeService(store, BackendRegistry.Create(credentials));

var startupMs = (DateTime.Now - Process.GetCurrentProcess().StartTime).TotalMilliseconds;
var query = new Panoptic.Sidecar.Query.QueryService(store, tree, Notify);
var catalogCache = new Panoptic.Sidecar.Catalog.CatalogCache(Environment.GetEnvironmentVariable("PANOPTIC_CATALOG") ?? Panoptic.Sidecar.Catalog.CatalogCache.DefaultFolder);
// Snapshots of connections deleted while no sidecar was running (or before snapshots were removed on delete).
_ = Task.Run(() => catalogCache.Prune(store.ConnectionIds()));
var catalog = new Panoptic.Sidecar.Catalog.CatalogService(
    p => tree.ResolveTarget(p.NodeId, p.Database),
    catalogCache,
    new Panoptic.Sidecar.Catalog.CatalogSources(store, tree),
    (method, notice) => Notify(method, w => JsonSerializer.Serialize(w, notice, SidecarJson.Default.CatalogNotice)));
var dispatcher = new JsonRpcDispatcher(Methods.Create(new SidecarInfo(Math.Round(startupMs, 1), version, mode), store, tree, query, catalog));

// Requests run concurrently so a slow expand never blocks ping, another expand or a $/cancelRequest.
// HandleAsync registers each request on this loop before yielding to the thread pool, so a cancel read
// after its request always finds it.
var inFlight = new List<Task>();
while (await stdin.ReadLineAsync() is { } line)
{
    if (string.IsNullOrWhiteSpace(line)) continue;
    inFlight.RemoveAll(t => t.IsCompleted);
    inFlight.Add(Handle(line));
}
await Task.WhenAll(inFlight);

async Task Handle(string line)
{
    if (await dispatcher.HandleAsync(line) is { } response) await WriteLine(response);
}
