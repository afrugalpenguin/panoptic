using System.Text.Json;
using Panoptic.Sidecar;

namespace Panoptic.Sidecar.Tests;

public class JsonRpcDispatcherTests
{
    private static JsonRpcDispatcher CreateDispatcher() =>
        new(new Dictionary<string, RpcHandler>
        {
            ["echo"] = (p, _) => Task.FromResult<Action<Utf8JsonWriter>>(w => p!.Value.WriteTo(w)),
            ["boom"] = (_, _) => throw new InvalidOperationException("kaboom"),
            ["slow"] = async (p, _) =>
            {
                await Task.Yield();
                return w => p!.Value.WriteTo(w);
            },
            ["bad"] = (_, _) => throw new RpcException(RpcException.InvalidParams, "nope"),
        });

    private static JsonElement Parse(string? response)
    {
        Assert.NotNull(response);
        Assert.DoesNotContain('\n', response);
        return JsonDocument.Parse(response).RootElement;
    }

    [Fact]
    public async Task Request_returns_result_with_same_numeric_id()
    {
        var r = Parse(await CreateDispatcher().HandleAsync("""{"jsonrpc":"2.0","id":7,"method":"echo","params":{"a":1}}"""));

        Assert.Equal("2.0", r.GetProperty("jsonrpc").GetString());
        Assert.Equal(7, r.GetProperty("id").GetInt32());
        Assert.Equal(1, r.GetProperty("result").GetProperty("a").GetInt32());
    }

    [Fact]
    public async Task Request_preserves_string_id()
    {
        var r = Parse(await CreateDispatcher().HandleAsync("""{"jsonrpc":"2.0","id":"abc","method":"echo","params":[]}"""));

        Assert.Equal("abc", r.GetProperty("id").GetString());
    }

    [Fact]
    public async Task Unknown_method_returns_method_not_found()
    {
        var r = Parse(await CreateDispatcher().HandleAsync("""{"jsonrpc":"2.0","id":1,"method":"nope"}"""));

        Assert.Equal(-32601, r.GetProperty("error").GetProperty("code").GetInt32());
        Assert.Equal(1, r.GetProperty("id").GetInt32());
    }

    [Fact]
    public async Task Malformed_json_returns_parse_error_with_null_id()
    {
        var r = Parse(await CreateDispatcher().HandleAsync("{not json"));

        Assert.Equal(-32700, r.GetProperty("error").GetProperty("code").GetInt32());
        Assert.Equal(JsonValueKind.Null, r.GetProperty("id").ValueKind);
    }

    [Theory]
    [InlineData("""{"id":1,"method":"echo"}""")]
    [InlineData("""{"jsonrpc":"1.0","id":1,"method":"echo"}""")]
    [InlineData("""{"jsonrpc":"2.0","id":1}""")]
    [InlineData("""[1,2]""")]
    public async Task Invalid_request_returns_invalid_request(string line)
    {
        var r = Parse(await CreateDispatcher().HandleAsync(line));

        Assert.Equal(-32600, r.GetProperty("error").GetProperty("code").GetInt32());
    }

    [Fact]
    public async Task Notification_gets_no_response()
    {
        Assert.Null(await CreateDispatcher().HandleAsync("""{"jsonrpc":"2.0","method":"echo","params":{}}"""));
    }

    [Fact]
    public async Task Handler_exception_returns_internal_error_without_crashing()
    {
        var r = Parse(await CreateDispatcher().HandleAsync("""{"jsonrpc":"2.0","id":2,"method":"boom"}"""));

        Assert.Equal(-32603, r.GetProperty("error").GetProperty("code").GetInt32());
        Assert.Equal("kaboom", r.GetProperty("error").GetProperty("message").GetString());
    }

    [Fact]
    public async Task Params_survive_an_await_inside_the_handler()
    {
        var r = Parse(await CreateDispatcher().HandleAsync("""{"jsonrpc":"2.0","id":3,"method":"slow","params":{"a":2}}"""));

        Assert.Equal(2, r.GetProperty("result").GetProperty("a").GetInt32());
    }

    [Fact]
    public async Task RpcException_maps_to_its_error_code()
    {
        var r = Parse(await CreateDispatcher().HandleAsync("""{"jsonrpc":"2.0","id":4,"method":"bad"}"""));

        Assert.Equal(-32602, r.GetProperty("error").GetProperty("code").GetInt32());
    }

    /// <summary>A handler that waits on its token until cancelled, recording that it saw the cancel.</summary>
    private static (JsonRpcDispatcher Dispatcher, TaskCompletionSource Started, TaskCompletionSource Observed) Waiting()
    {
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var observed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var dispatcher = new JsonRpcDispatcher(new Dictionary<string, RpcHandler>
        {
            ["wait"] = async (_, ct) =>
            {
                started.SetResult();
                try
                {
                    await Task.Delay(Timeout.Infinite, ct);
                }
                catch (OperationCanceledException)
                {
                    observed.SetResult();
                    throw;
                }
                return w => w.WriteNullValue();
            },
            ["echo"] = (p, _) => Task.FromResult<Action<Utf8JsonWriter>>(w => p!.Value.WriteTo(w)),
        });
        return (dispatcher, started, observed);
    }

    [Fact]
    public async Task CancelRequest_cancels_the_in_flight_request_and_answers_request_cancelled()
    {
        var (dispatcher, started, observed) = Waiting();

        // Same order as the stdin loop: start the request, then handle the cancel while it is still running.
        var request = dispatcher.HandleAsync("""{"jsonrpc":"2.0","id":5,"method":"wait"}""");
        await started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.False(request.IsCompleted);
        Assert.Equal(1, dispatcher.InFlightCount);

        Assert.Null(await dispatcher.HandleAsync("""{"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":5}}"""));

        var r = Parse(await request.WaitAsync(TimeSpan.FromSeconds(5)));
        Assert.True(observed.Task.IsCompleted);
        Assert.Equal(5, r.GetProperty("id").GetInt32());
        Assert.Equal(RpcException.RequestCancelled, r.GetProperty("error").GetProperty("code").GetInt32());
        Assert.Equal(-32800, RpcException.RequestCancelled);
        Assert.Equal(0, dispatcher.InFlightCount);
    }

    [Fact]
    public async Task CancelRequest_handled_before_the_request_first_yields_still_cancels_it()
    {
        var (dispatcher, _, observed) = Waiting();

        // No wait for the handler to start: registration happens before HandleAsync returns its task.
        var request = dispatcher.HandleAsync("""{"jsonrpc":"2.0","id":"q1","method":"wait"}""");
        await dispatcher.HandleAsync("""{"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":"q1"}}""");

        var r = Parse(await request.WaitAsync(TimeSpan.FromSeconds(5)));
        Assert.Equal(RpcException.RequestCancelled, r.GetProperty("error").GetProperty("code").GetInt32());
        await observed.Task.WaitAsync(TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task CancelRequest_matches_the_id_exactly()
    {
        var (dispatcher, started, _) = Waiting();
        var request = dispatcher.HandleAsync("""{"jsonrpc":"2.0","id":7,"method":"wait"}""");
        await started.Task.WaitAsync(TimeSpan.FromSeconds(5));

        // "7" is not 7, and an unknown id is ignored without a response.
        Assert.Null(await dispatcher.HandleAsync("""{"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":"7"}}"""));
        Assert.Null(await dispatcher.HandleAsync("""{"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":99}}"""));
        Assert.Null(await dispatcher.HandleAsync("""{"jsonrpc":"2.0","method":"$/cancelRequest"}"""));
        await Task.Delay(50);
        Assert.False(request.IsCompleted);

        await dispatcher.HandleAsync("""{"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":7}}""");
        Parse(await request.WaitAsync(TimeSpan.FromSeconds(5)));
    }

    [Fact]
    public async Task CancelRequest_after_completion_is_a_no_op_and_nothing_stays_registered()
    {
        var (dispatcher, _, _) = Waiting();

        var r = Parse(await dispatcher.HandleAsync("""{"jsonrpc":"2.0","id":1,"method":"echo","params":{"a":1}}"""));
        Assert.Equal(1, r.GetProperty("result").GetProperty("a").GetInt32());
        Assert.Equal(0, dispatcher.InFlightCount);

        Assert.Null(await dispatcher.HandleAsync("""{"jsonrpc":"2.0","method":"$/cancelRequest","params":{"id":1}}"""));

        // The id can be reused and runs normally.
        r = Parse(await dispatcher.HandleAsync("""{"jsonrpc":"2.0","id":1,"method":"echo","params":{"a":2}}"""));
        Assert.Equal(2, r.GetProperty("result").GetProperty("a").GetInt32());
        Assert.Equal(0, dispatcher.InFlightCount);
    }

    [Fact]
    public async Task Ping_reports_startup_time_and_version()
    {
        var dispatcher = new JsonRpcDispatcher(Methods.Create(new SidecarInfo(StartupMs: 123.4, Version: "0.1.0", Mode: "test")));

        var result = Parse(await dispatcher.HandleAsync("""{"jsonrpc":"2.0","id":1,"method":"ping"}""")).GetProperty("result");

        Assert.Equal(123.4, result.GetProperty("startupMs").GetDouble());
        Assert.Equal("0.1.0", result.GetProperty("version").GetString());
        Assert.Equal("test", result.GetProperty("mode").GetString());
        Assert.True(result.GetProperty("pid").GetInt32() > 0);
    }
}
