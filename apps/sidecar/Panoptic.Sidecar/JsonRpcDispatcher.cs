using System.Text;
using System.Text.Json;

namespace Panoptic.Sidecar;

/// <summary>Writes a method's result value. Params is null when the request had none.</summary>
public delegate void RpcHandler(JsonElement? parameters, Utf8JsonWriter result);

/// <summary>
/// JSON-RPC 2.0 over newline-delimited JSON. One request line in, at most one response line out.
/// Hand-rolled with Utf8JsonWriter so it stays reflection-free for trimming and Native AOT.
/// </summary>
public sealed class JsonRpcDispatcher(IReadOnlyDictionary<string, RpcHandler> handlers)
{
    private const int ParseError = -32700;
    private const int InvalidRequest = -32600;
    private const int MethodNotFound = -32601;
    private const int InternalError = -32603;

    /// <summary>Returns the response line, or null for a notification.</summary>
    public string? Handle(string line)
    {
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(line);
        }
        catch (JsonException)
        {
            return Error(null, ParseError, "Parse error");
        }

        using (doc)
        {
            var root = doc.RootElement;
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
                if (id is null)
                {
                    handler(parameters, NullWriter);
                    return null;
                }

                return Write(w =>
                {
                    Header(w, id);
                    w.WritePropertyName("result");
                    handler(parameters, w);
                });
            }
            catch (Exception ex)
            {
                return id is null ? null : Error(id, InternalError, ex.Message);
            }
        }
    }

    private static readonly Utf8JsonWriter NullWriter = new(Stream.Null);

    private static string Error(JsonElement? id, int code, string message) => Write(w =>
    {
        Header(w, id);
        w.WriteStartObject("error");
        w.WriteNumber("code", code);
        w.WriteString("message", message);
        w.WriteEndObject();
    });

    private static void Header(Utf8JsonWriter w, JsonElement? id)
    {
        w.WriteString("jsonrpc", "2.0");
        w.WritePropertyName("id");
        if (id is null) w.WriteNullValue();
        else id.Value.WriteTo(w);
    }

    private static string Write(Action<Utf8JsonWriter> body)
    {
        using var buffer = new MemoryStream();
        using (var w = new Utf8JsonWriter(buffer))
        {
            w.WriteStartObject();
            body(w);
            w.WriteEndObject();
        }
        return Encoding.UTF8.GetString(buffer.ToArray());
    }
}
