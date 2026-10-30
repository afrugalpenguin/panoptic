using System.Net.Sockets;
using System.Security.Authentication;
using Npgsql;

namespace Panoptic.Sidecar.Backends;

/// <summary>Turns Postgres failures into node errors, keyed by SQLSTATE.</summary>
public static class PostgresErrors
{
    public static readonly IReadOnlyDictionary<string, (string Summary, bool Retryable)> Table = new Dictionary<string, (string, bool)>
    {
        ["28P01"] = ("Sign-in failed. Check the user name and password.", false),
        ["28000"] = ("The server refused this connection. Check its firewall rules and the user's role.", false),
        ["3D000"] = ("Database does not exist, or the user cannot see it.", false),
        ["42501"] = ("Permission denied.", false),
        ["57P03"] = ("The server is starting up. Retry in a moment.", true),
        ["53300"] = ("The server has no free connections. Retry later.", true),
    };

    /// <summary>Failed password check on an Entra connection: the token was fine, so the role is the problem.</summary>
    public const string EntraSignInFailed = "Sign-in failed. Check the user is the Entra name of a role on the server.";

    public const string Unreachable = "Server not found or not reachable. Check the server name and network.";

    public const string Untrusted = "The server's certificate could not be verified. For a local or dev server, tick Trust server certificate.";

    public static NodeError Map(string? sqlState, string message, ConnectionConfig c, string? database)
    {
        var extra = NodeErrors.Lines(
            ("SQLSTATE", sqlState),
            ("Server", c.Endpoint),
            ("Database", database),
            ("Identity", NodeErrors.Identity(c)));
        if (sqlState is null) return NodeErrors.Mapped((Unreachable, true), message, "network", extra);
        if (sqlState == "28P01" && c.Auth == AuthKinds.Entra) return NodeErrors.Mapped((EntraSignInFailed, false), message, sqlState, extra);
        return Table.TryGetValue(sqlState, out var entry)
            ? NodeErrors.Mapped(entry, message, sqlState, extra)
            : NodeErrors.Fallback(message, sqlState, extra);
    }

    /// <summary>Keeps the server's own message as the RPC message. An NpgsqlException that is not a PostgresException
    /// never reached the server (DNS, refused, timeout, TLS): it maps by its cause, with the innermost message.</summary>
    public static RpcException ToRpc(NpgsqlException ex, ConnectionConfig c, string? database)
    {
        if (ex is PostgresException pg)
            return new RpcException(RpcException.OperationFailed, pg.MessageText, Map(pg.SqlState, pg.MessageText, c, database));

        var message = Innermost(ex).Message;
        var extra = NodeErrors.Lines(("Server", c.Endpoint), ("Database", database), ("Identity", NodeErrors.Identity(c)));
        var error = ex.InnerException is AuthenticationException
            ? NodeErrors.Mapped((Untrusted, false), message, "tls", extra)
            : ex.InnerException is SocketException or TimeoutException || ex.IsTransient
                ? Map(null, message, c, database)
                : NodeErrors.Fallback(message, extra: extra);
        return new RpcException(RpcException.OperationFailed, message, error);
    }

    private static Exception Innermost(Exception ex)
    {
        while (ex.InnerException is not null) ex = ex.InnerException;
        return ex;
    }
}
