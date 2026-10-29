using System.Diagnostics;
using System.Reflection;
using System.Text;
using Panoptic.Sidecar;

// stdout carries protocol traffic only; anything diagnostic goes to stderr.
var assembly = typeof(Methods).Assembly;
var mode = assembly.GetCustomAttributes<AssemblyMetadataAttribute>().FirstOrDefault(a => a.Key == "PublishMode")?.Value ?? "dev";
var version = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0] ?? "0.0.0";

using var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
using var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true, NewLine = "\n" };

var startupMs = (DateTime.Now - Process.GetCurrentProcess().StartTime).TotalMilliseconds;
var dispatcher = new JsonRpcDispatcher(Methods.Create(new SidecarInfo(Math.Round(startupMs, 1), version, mode)));

while (await stdin.ReadLineAsync() is { } line)
{
    if (string.IsNullOrWhiteSpace(line)) continue;
    if (dispatcher.Handle(line) is { } response) await stdout.WriteLineAsync(response);
}
