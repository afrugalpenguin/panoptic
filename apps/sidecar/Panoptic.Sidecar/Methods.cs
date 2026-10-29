namespace Panoptic.Sidecar;

/// <summary>What the sidecar reports about itself. StartupMs is process start to ready-to-read-stdin.</summary>
public sealed record SidecarInfo(double StartupMs, string Version, string Mode);

public static class Methods
{
    public static Dictionary<string, RpcHandler> Create(SidecarInfo info) => new()
    {
        ["ping"] = (_, w) =>
        {
            w.WriteStartObject();
            w.WriteNumber("startupMs", info.StartupMs);
            w.WriteString("version", info.Version);
            w.WriteString("mode", info.Mode);
            w.WriteNumber("pid", Environment.ProcessId);
            w.WriteEndObject();
        },
    };
}
