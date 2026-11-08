using System.Net;
using System.Net.Sockets;
using Panoptic.Sidecar.Backends;

namespace Panoptic.Sidecar.Tests;

/// <summary>Engine warm-up and the Cosmos loopback connect (#185).</summary>
public class WarmUpTests
{
    /// <summary>
    /// Program.cs ignores warm-up failures, so this is where one shows: Cosmos's canned replies must still satisfy the
    /// SDK after an upgrade.
    /// </summary>
    [Fact]
    public async Task Every_backend_warms_up_without_failing()
    {
        foreach (var backend in BackendRegistry.Create(new Credentials(_ => { })).Values.Distinct())
            await backend.WarmUpAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(60));
    }

    [Fact]
    public async Task Localhost_reaches_an_emulator_listening_on_127_0_0_1_only()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        try
        {
            var port = ((IPEndPoint)listener.LocalEndpoint).Port;
            var accept = listener.AcceptSocketAsync();
            await using var stream = await CosmosBackend.ConnectLoopbackAsync(new DnsEndPoint("localhost", port), CancellationToken.None);
            using var server = await accept.WaitAsync(TimeSpan.FromSeconds(30));
            Assert.Equal(IPAddress.Loopback, ((IPEndPoint)server.RemoteEndPoint!).Address);
        }
        finally
        {
            listener.Stop();
        }
    }

    [Fact]
    public async Task Localhost_reaches_an_emulator_listening_on_ipv6_only()
    {
        if (!Socket.OSSupportsIPv6) return;
        var listener = new TcpListener(IPAddress.IPv6Loopback, 0);
        listener.Start();
        try
        {
            var port = ((IPEndPoint)listener.LocalEndpoint).Port;
            var accept = listener.AcceptSocketAsync();
            await using var stream = await CosmosBackend.ConnectLoopbackAsync(new DnsEndPoint("localhost", port), CancellationToken.None);
            using var server = await accept.WaitAsync(TimeSpan.FromSeconds(30));
            Assert.Equal(IPAddress.IPv6Loopback, ((IPEndPoint)server.RemoteEndPoint!).Address);
        }
        finally
        {
            listener.Stop();
        }
    }

    [Fact]
    public async Task Nothing_listening_is_a_socket_error()
    {
        // A port that was free a moment ago.
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();

        await Assert.ThrowsAsync<SocketException>(async () =>
            await CosmosBackend.ConnectLoopbackAsync(new DnsEndPoint("127.0.0.1", port), CancellationToken.None));
    }
}
