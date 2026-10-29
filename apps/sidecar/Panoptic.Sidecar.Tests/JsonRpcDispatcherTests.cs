using System.Text.Json;
using Panoptic.Sidecar;

namespace Panoptic.Sidecar.Tests;

public class JsonRpcDispatcherTests
{
    private static JsonRpcDispatcher CreateDispatcher() =>
        new(new Dictionary<string, RpcHandler>
        {
            ["echo"] = (p, w) => p!.Value.WriteTo(w),
            ["boom"] = (_, _) => throw new InvalidOperationException("kaboom"),
        });

    private static JsonElement Parse(string? response)
    {
        Assert.NotNull(response);
        Assert.DoesNotContain('\n', response);
        return JsonDocument.Parse(response).RootElement;
    }

    [Fact]
    public void Request_returns_result_with_same_numeric_id()
    {
        var r = Parse(CreateDispatcher().Handle("""{"jsonrpc":"2.0","id":7,"method":"echo","params":{"a":1}}"""));

        Assert.Equal("2.0", r.GetProperty("jsonrpc").GetString());
        Assert.Equal(7, r.GetProperty("id").GetInt32());
        Assert.Equal(1, r.GetProperty("result").GetProperty("a").GetInt32());
    }

    [Fact]
    public void Request_preserves_string_id()
    {
        var r = Parse(CreateDispatcher().Handle("""{"jsonrpc":"2.0","id":"abc","method":"echo","params":[]}"""));

        Assert.Equal("abc", r.GetProperty("id").GetString());
    }

    [Fact]
    public void Unknown_method_returns_method_not_found()
    {
        var r = Parse(CreateDispatcher().Handle("""{"jsonrpc":"2.0","id":1,"method":"nope"}"""));

        Assert.Equal(-32601, r.GetProperty("error").GetProperty("code").GetInt32());
        Assert.Equal(1, r.GetProperty("id").GetInt32());
    }

    [Fact]
    public void Malformed_json_returns_parse_error_with_null_id()
    {
        var r = Parse(CreateDispatcher().Handle("{not json"));

        Assert.Equal(-32700, r.GetProperty("error").GetProperty("code").GetInt32());
        Assert.Equal(JsonValueKind.Null, r.GetProperty("id").ValueKind);
    }

    [Theory]
    [InlineData("""{"id":1,"method":"echo"}""")]
    [InlineData("""{"jsonrpc":"1.0","id":1,"method":"echo"}""")]
    [InlineData("""{"jsonrpc":"2.0","id":1}""")]
    [InlineData("""[1,2]""")]
    public void Invalid_request_returns_invalid_request(string line)
    {
        var r = Parse(CreateDispatcher().Handle(line));

        Assert.Equal(-32600, r.GetProperty("error").GetProperty("code").GetInt32());
    }

    [Fact]
    public void Notification_gets_no_response()
    {
        Assert.Null(CreateDispatcher().Handle("""{"jsonrpc":"2.0","method":"echo","params":{}}"""));
    }

    [Fact]
    public void Handler_exception_returns_internal_error_without_crashing()
    {
        var r = Parse(CreateDispatcher().Handle("""{"jsonrpc":"2.0","id":2,"method":"boom"}"""));

        Assert.Equal(-32603, r.GetProperty("error").GetProperty("code").GetInt32());
        Assert.Equal("kaboom", r.GetProperty("error").GetProperty("message").GetString());
    }

    [Fact]
    public void Ping_reports_startup_time_and_version()
    {
        var dispatcher = new JsonRpcDispatcher(Methods.Create(new SidecarInfo(StartupMs: 123.4, Version: "0.1.0", Mode: "test")));

        var result = Parse(dispatcher.Handle("""{"jsonrpc":"2.0","id":1,"method":"ping"}""")).GetProperty("result");

        Assert.Equal(123.4, result.GetProperty("startupMs").GetDouble());
        Assert.Equal("0.1.0", result.GetProperty("version").GetString());
        Assert.Equal("test", result.GetProperty("mode").GetString());
        Assert.True(result.GetProperty("pid").GetInt32() > 0);
    }
}
