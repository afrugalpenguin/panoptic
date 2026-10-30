using Microsoft.Data.SqlClient;

namespace Panoptic.Sidecar.Backends;

/// <summary>Turns SQL Server failures into node errors, keyed by SQL error number.</summary>
public static class SqlErrors
{
    public static readonly IReadOnlyDictionary<int, (string Summary, bool Retryable)> Table = new Dictionary<int, (string, bool)>
    {
        [4060] = ("Cannot open the database. It may not exist, or the login lacks access.", false),
        [18456] = ("Login failed. Check the user name and password, or the auth method.", false),
        [40615] = ("Blocked by the server firewall. Add a firewall rule for this machine.", false),
        [2] = ("Server not found or not reachable. Check the server name and network.", true),
        [-2] = ("The server took too long to respond. Retry, or check the network.", true),
    };

    public static NodeError Map(int number, string message, int state, string? clientConnectionId, ConnectionConfig c, string? database)
    {
        var code = $"{number}";
        var extra = NodeErrors.Lines(
            ("Error", code),
            ("State", $"{state}"),
            ("Server", c.Endpoint),
            ("Database", database),
            ("Identity", NodeErrors.Identity(c)),
            ("ClientConnectionId", clientConnectionId));
        return Table.TryGetValue(number, out var entry)
            ? NodeErrors.Mapped(entry, message, code, extra)
            : NodeErrors.Fallback(message, code, extra);
    }

    /// <summary>Keeps SQL Server's own message as the RPC message: query tabs show it in their messages pane.</summary>
    public static RpcException ToRpc(SqlException ex, ConnectionConfig c, string? database)
    {
        var error = Map(ex.Number, ex.Message, ex.State, ex.ClientConnectionId == Guid.Empty ? null : ex.ClientConnectionId.ToString(), c, database);
        return new RpcException(RpcException.OperationFailed, ex.Message, error);
    }
}
