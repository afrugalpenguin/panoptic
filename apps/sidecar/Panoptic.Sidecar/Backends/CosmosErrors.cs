using Microsoft.Azure.Cosmos;

namespace Panoptic.Sidecar.Backends;

/// <summary>Turns Cosmos DB failures into node errors. Keys are "status" or "status/substatus"; the more specific wins.</summary>
public static class CosmosErrors
{
    public static readonly IReadOnlyDictionary<string, (string Summary, bool Retryable)> Table = new Dictionary<string, (string, bool)>
    {
        ["403/5300"] = ("No data-plane access. Identity needs a Cosmos DB role such as Built-in Data Reader.", false),
        ["401"] = ("Cosmos DB rejected the credentials. Check the account key or sign-in.", false),
        ["404"] = ("Not found. It may have been deleted or renamed; refresh the parent.", false),
        ["429"] = ("Cosmos DB is throttling requests. Wait a moment, then retry.", true),
    };

    public static NodeError Map(int status, int substatus, string message, string? activityId, ConnectionConfig c)
    {
        var code = substatus == 0 ? $"{status}" : $"{status}/{substatus}";
        var extra = NodeErrors.Lines(
            ("Status", $"{status}"),
            ("Substatus", substatus == 0 ? null : $"{substatus}"),
            ("ActivityId", activityId),
            ("Endpoint", c.Endpoint),
            ("Identity", NodeErrors.Identity(c)));
        if (Table.TryGetValue(code, out var entry) || Table.TryGetValue($"{status}", out entry))
            return NodeErrors.Mapped(entry, message, code, extra);
        return NodeErrors.Fallback(message, code, extra);
    }

    public static RpcException ToRpc(CosmosException ex, ConnectionConfig c)
    {
        var error = Map((int)ex.StatusCode, ex.SubStatusCode, ex.Message, ex.ActivityId, c);
        return new RpcException(RpcException.OperationFailed, error.Summary, error);
    }
}
