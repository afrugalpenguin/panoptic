using System.Text.Json;
using Panoptic.Sidecar;
using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Tests;

public class NodeErrorTests
{
    private static readonly ConnectionConfig Cosmos = new("c1", "orders", ConnectionKinds.Cosmos, "https://orders-dev.documents.example.com:443/", AuthKinds.Entra);
    private static readonly ConnectionConfig Sql = new("s1", "orders", ConnectionKinds.Sql, "orders-dev.example.com", AuthKinds.Sql, User: "app_reader");

    private const string CosmosMessage =
        "Response status code does not indicate success: Forbidden (403); Substatus: 5300; ActivityId: 0f8fad5b-d9cb-469f-a165-70867728950e; Reason: (Request blocked by Auth orders-dev : principal [00000000-0000-0000-0000-000000000000] does not have required RBAC permissions);";

    [Fact]
    public void Cosmos_403_5300_explains_the_missing_data_plane_role()
    {
        var e = CosmosErrors.Map(403, 5300, CosmosMessage, "0f8fad5b-d9cb-469f-a165-70867728950e", Cosmos);

        Assert.Equal("No data-plane access. Identity needs a Cosmos DB role such as Built-in Data Reader.", e.Summary);
        Assert.Equal("403/5300", e.Code);
        Assert.False(e.Retryable);
        Assert.StartsWith(CosmosMessage, e.Detail);
        Assert.Contains("Status: 403", e.Detail);
        Assert.Contains("Substatus: 5300", e.Detail);
        Assert.Contains("ActivityId: 0f8fad5b-d9cb-469f-a165-70867728950e", e.Detail);
        Assert.Contains("Endpoint: https://orders-dev.documents.example.com:443/", e.Detail);
        Assert.Contains("Identity: Entra ID (default tenant)", e.Detail);
    }

    [Fact]
    public void Cosmos_401_points_at_the_credentials()
    {
        var e = CosmosErrors.Map(401, 0, "Unauthorized (401)", null, Cosmos with { Auth = AuthKinds.Key });
        Assert.Equal(("401", false), (e.Code, e.Retryable));
        Assert.Contains("credentials", e.Summary);
        Assert.Contains("Identity: Account key", e.Detail);
    }

    [Fact]
    public void Cosmos_404_with_any_substatus_says_not_found()
    {
        var e = CosmosErrors.Map(404, 1003, "NotFound (404); Substatus: 1003", null, Cosmos);
        Assert.Equal(("404/1003", false), (e.Code, e.Retryable));
        Assert.StartsWith("Not found.", e.Summary);
    }

    [Fact]
    public void Cosmos_429_is_retryable()
    {
        var e = CosmosErrors.Map(429, 3200, "TooManyRequests (429)", null, Cosmos);
        Assert.Equal(("429/3200", true), (e.Code, e.Retryable));
        Assert.Contains("throttling", e.Summary);
    }

    [Theory]
    [InlineData(4060, "Cannot open database \"orders\" requested by the login. The login failed.", "Cannot open the database", false)]
    [InlineData(18456, "Login failed for user 'app_reader'.", "Login failed.", false)]
    [InlineData(40615, "Cannot open server 'orders-dev' requested by the login. Client with IP address '192.0.2.1' is not allowed to access the server.", "firewall", false)]
    [InlineData(2, "A network-related or instance-specific error occurred while establishing a connection to SQL Server.", "not reachable", true)]
    [InlineData(-2, "Execution Timeout Expired. The timeout period elapsed prior to completion of the operation or the server is not responding.", "too long", true)]
    public void Sql_mapped_numbers(int number, string message, string expected, bool retryable)
    {
        var e = SqlErrors.Map(number, message, 1, null, Sql, "orders");

        Assert.Contains(expected, e.Summary);
        Assert.Equal($"{number}", e.Code);
        Assert.Equal(retryable, e.Retryable);
        Assert.True(e.Summary.Length < NodeErrors.MaxSummary, e.Summary);
        Assert.DoesNotContain("orders", e.Summary);
        Assert.StartsWith(message, e.Detail);
        Assert.Contains($"Error: {number}", e.Detail);
        Assert.Contains("Server: orders-dev.example.com", e.Detail);
        Assert.Contains("Identity: SQL login app_reader", e.Detail);
    }

    [Fact]
    public void Unmapped_errors_fall_back_to_the_first_sentence()
    {
        var sql = SqlErrors.Map(229, "The SELECT permission was denied on the object 'orders'. Something else.", 1, null, Sql, "orders");
        Assert.Equal("The SELECT permission was denied on the object 'orders'.", sql.Summary);
        Assert.Equal("229", sql.Code);
        Assert.StartsWith("The SELECT permission was denied on the object 'orders'. Something else.", sql.Detail);

        var cosmos = CosmosErrors.Map(403, 0, CosmosMessage.Replace("5300", "0"), null, Cosmos);
        Assert.Equal("Response status code does not indicate success: Forbidden (403)", cosmos.Summary);
        Assert.Equal("403", cosmos.Code);

        var plain = NodeErrors.Fallback(new string('x', 200));
        Assert.True(plain.Summary.Length <= NodeErrors.MaxSummary);
        Assert.EndsWith("…", plain.Summary);
        Assert.Equal(new string('x', 200), plain.Detail);
        Assert.Equal(string.Join(' ', Enumerable.Repeat("word", 15)) + "…", NodeErrors.FirstSentence(string.Concat(Enumerable.Repeat("word ", 30)) + "end"));
        Assert.Null(plain.Code);
        Assert.True(plain.Retryable);
    }

    [Fact]
    public async Task Dispatcher_sends_the_node_error_as_error_data()
    {
        var error = new NodeError("Login failed.", "full text", "18456", false);
        var dispatcher = new JsonRpcDispatcher(new Dictionary<string, RpcHandler>
        {
            ["fail"] = (_, _) => throw new RpcException(RpcException.OperationFailed, "raw message", error),
        });

        var response = await dispatcher.HandleAsync("""{"jsonrpc":"2.0","id":1,"method":"fail"}""");
        var e = JsonDocument.Parse(response!).RootElement.GetProperty("error");

        Assert.Equal("raw message", e.GetProperty("message").GetString());
        var data = e.GetProperty("data");
        Assert.Equal("Login failed.", data.GetProperty("summary").GetString());
        Assert.Equal("full text", data.GetProperty("detail").GetString());
        Assert.Equal("18456", data.GetProperty("code").GetString());
        Assert.False(data.GetProperty("retryable").GetBoolean());
    }
}
