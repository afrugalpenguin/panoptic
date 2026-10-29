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
var sql = new SqlBackend(credentials);
var tree = new TreeService(store, new Dictionary<string, IBackend>
{
    [ConnectionKinds.Sql] = sql,
    [ConnectionKinds.Synapse] = sql,
    [ConnectionKinds.Cosmos] = new CosmosBackend(credentials),
});

var startupMs = (DateTime.Now - Process.GetCurrentProcess().StartTime).TotalMilliseconds;
var dispatcher = new JsonRpcDispatcher(Methods.Create(new SidecarInfo(Math.Round(startupMs, 1), version, mode), store, tree));

// Requests run concurrently so a slow expand never blocks ping or another expand.
var inFlight = new List<Task>();
while (await stdin.ReadLineAsync() is { } line)
{
    if (string.IsNullOrWhiteSpace(line)) continue;
    inFlight.RemoveAll(t => t.IsCompleted);
    inFlight.Add(Task.Run(async () =>
    {
        if (await dispatcher.HandleAsync(line) is { } response) await WriteLine(response);
    }));
}
await Task.WhenAll(inFlight);
