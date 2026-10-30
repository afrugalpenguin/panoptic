using System.Net;
using Microsoft.Azure.Cosmos;
using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Tests;

public class CosmosThroughputTests
{
    private static Func<CancellationToken, Task<ThroughputResponse>> Throws(HttpStatusCode status, int substatus = 0) =>
        _ => throw new CosmosException($"Synthetic {(int)status}", status, substatus, "00000000-0000-0000-0000-000000000000", 1);

    [Fact]
    public async Task Forbidden_offer_read_degrades_to_a_message_without_reading_the_database()
    {
        var sharedCalls = 0;
        var result = await CosmosBackend.Throughput(
            Throws(HttpStatusCode.Forbidden, 5301),
            ct => { sharedCalls++; return Throws(HttpStatusCode.Forbidden, 5301)(ct); },
            CancellationToken.None);

        Assert.Equal("not visible with this identity", result);
        Assert.Equal(0, sharedCalls);
    }

    [Fact]
    public async Task Missing_dedicated_throughput_falls_through_to_the_database()
    {
        var sharedCalls = 0;
        var result = await CosmosBackend.Throughput(
            Throws(HttpStatusCode.NotFound),
            ct => { sharedCalls++; return Throws(HttpStatusCode.InternalServerError)(ct); },
            CancellationToken.None);

        Assert.Equal("unknown", result);
        Assert.Equal(1, sharedCalls);
    }

    [Fact]
    public async Task Bad_request_on_offer_read_means_serverless()
    {
        var result = await CosmosBackend.Throughput(Throws(HttpStatusCode.BadRequest), Throws(HttpStatusCode.InternalServerError), CancellationToken.None);
        Assert.Equal("serverless", result);
    }

    [Fact]
    public async Task Other_failures_on_the_container_read_still_escape()
    {
        var ex = await Assert.ThrowsAsync<CosmosException>(() =>
            CosmosBackend.Throughput(Throws(HttpStatusCode.TooManyRequests), Throws(HttpStatusCode.InternalServerError), CancellationToken.None));
        Assert.Equal(HttpStatusCode.TooManyRequests, ex.StatusCode);
    }
}
