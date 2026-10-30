using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace Panoptic.Sidecar;

/// <summary>
/// Handles one request. Params is null when the request had none, and is safe to keep past the
/// first await. Returns a writer for the result value.
/// </summary>
public delegate Task<Action<Utf8JsonWriter>> RpcHandler(JsonElement? parameters, CancellationToken cancellationToken);

/// <summary>Thrown by handlers to return a specific JSON-RPC error code, optionally with a structured node error as its data.</summary>
public sealed class RpcException(int code, string message, NodeError? nodeError = null) : Exception(message)
{
    public const int InvalidParams = -32602;
    /// <summary>Application error: the operation ran and failed (login failed, timeout, not found).</summary>
    public const int OperationFailed = -32000;

    public int Code { get; } = code;

    public NodeError? NodeError { get; } = nodeError;
}

/// <summary>
/// JSON-RPC 2.0 over newline-delimited JSON. One request line in, at most one response line out.
/// Hand-rolled with Utf8JsonWriter so it stays reflection-free.
/// </summary>
public sealed class JsonRpcDispatcher(IReadOnlyDictionary<string, RpcHandler> handlers)
{
    private const int ParseError = -32700;
    private const int InvalidRequest = -32600;
    private const int MethodNotFound = -32601;
    private const int InternalError = -32603;

    /// <summary>Returns the response line, or null for a notification.</summary>
    public async Task<string?> HandleAsync(string line, CancellationToken cancellationToken = default)
    {
        JsonElement root;
        try
        {
            using var doc = JsonDocument.Parse(line);
            root = doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            return Error(null, ParseError, "Parse error");
        }

        if (root.ValueKind != JsonValueKind.Object)
            return Error(null, InvalidRequest, "Invalid request");

        JsonElement? id = root.TryGetProperty("id", out var idEl) ? idEl : null;

        if (!root.TryGetProperty("jsonrpc", out var version) || version.ValueKind != JsonValueKind.String || version.GetString() != "2.0"
            || !root.TryGetProperty("method", out var methodEl) || methodEl.ValueKind != JsonValueKind.String)
            return Error(id, InvalidRequest, "Invalid request");

        var method = methodEl.GetString()!;
        JsonElement? parameters = root.TryGetProperty("params", out var p) ? p : null;

        if (!handlers.TryGetValue(method, out var handler))
            return id is null ? null : Error(id, MethodNotFound, $"Method not found: {method}");

        try
        {
            var result = await handler(parameters, cancellationToken);
            if (id is null) return null;
            return Write(w =>
            {
                Header(w, id);
                w.WritePropertyName("result");
                result(w);
            });
        }
        catch (RpcException ex)
        {
            return id is null ? null : Error(id, ex.Code, ex.Message, ex.NodeError);
        }
        catch (Exception ex)
        {
            return id is null ? null : Error(id, InternalError, ex.Message);
        }
    }

    public static string Notification(string method, Action<Utf8JsonWriter> parameters) => Write(w =>
    {
        w.WriteString("jsonrpc", "2.0");
        w.WriteString("method", method);
        w.WritePropertyName("params");
        parameters(w);
    });

    private static string Error(JsonElement? id, int code, string message, NodeError? data = null) => Write(w =>
    {
        Header(w, id);
        w.WriteStartObject("error");
        w.WriteNumber("code", code);
        w.WriteString("message", message);
        if (data is not null)
        {
            w.WritePropertyName("data");
            JsonSerializer.Serialize(w, data, SidecarJson.Default.NodeError);
        }
        w.WriteEndObject();
    });

    private static void Header(Utf8JsonWriter w, JsonElement? id)
    {
        w.WriteString("jsonrpc", "2.0");
        w.WritePropertyName("id");
        if (id is null) w.WriteNullValue();
        else id.Value.WriteTo(w);
    }

    /// <summary>
    /// Minimal escaping: this JSON goes over a pipe to the UI, never into HTML, so escaping quotes, +, &lt;
    /// and non-ASCII the HTML-safe default way would only make 100k-row result streams bigger.
    /// </summary>
    public static readonly JsonWriterOptions WriterOptions = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    private static string Write(Action<Utf8JsonWriter> body)
    {
        using var buffer = new MemoryStream();
        using (var w = new Utf8JsonWriter(buffer, WriterOptions))
        {
            w.WriteStartObject();
            body(w);
            w.WriteEndObject();
        }
        return Encoding.UTF8.GetString(buffer.ToArray());
    }
}
